import express from "express";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import { google } from "googleapis";
import path from "path";
import dotenv from "dotenv";
import { Firestore } from "@google-cloud/firestore";

dotenv.config();

function indexToColumn(index: number): string {
  let column = "";
  while (index >= 0) {
    column = String.fromCharCode((index % 26) + 65) + column;
    index = Math.floor(index / 26) - 1;
  }
  return column;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(cookieParser());
  app.use(express.json());

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  const getRedirectUri = (req: express.Request) => {
    // In preview environment, use APP_URL if available, otherwise fallback to request origin
    const appUrl = process.env.APP_URL;
    if (appUrl) {
      return `${appUrl}/auth/callback`;
    }
    return `${req.protocol}://${req.get("host")}/auth/callback`;
  };

  const createOAuth2Client = (redirectUri: string) => {
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
  };

  app.get("/api/auth/url", (req, res) => {
    const redirectUri = req.query.redirectUri as string;
    if (!redirectUri) {
      res.status(400).json({ error: "Missing redirectUri" });
      return;
    }
    const oauth2Client = createOAuth2Client(redirectUri);

    const scopes = [
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
    ];

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: "consent",
      state: encodeURIComponent(redirectUri),
    });

    res.json({ url });
  });

  app.get(["/auth/callback", "/auth/callback/"], async (req, res) => {
    const { code, state } = req.query;
    if (!code || typeof code !== "string") {
      res.status(400).send("Missing code");
      return;
    }
    
    // We need the redirectUri to exchange the code. 
    // We can pass it via the state parameter.
    const redirectUri = state ? decodeURIComponent(state as string) : getRedirectUri(req);

    try {
      const oauth2Client = createOAuth2Client(redirectUri);
      const { tokens } = await oauth2Client.getToken(code);

      // Verify email against allowed list
      oauth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({
        auth: oauth2Client,
        version: "v2",
      });
      const userInfo = await oauth2.userinfo.get();
      const userEmail = userInfo.data.email;
      
      if (process.env.ALLOWED_EMAILS) {
        const allowedEmails = process.env.ALLOWED_EMAILS.split(',').map(e => e.trim().toLowerCase());
        if (!userEmail || !allowedEmails.includes(userEmail.toLowerCase())) {
          res.status(403).send(`
            <html>
              <body>
                <h2>Access Denied</h2>
                <p>Your email (${userEmail}) is not authorized to access this application.</p>
                <script>
                  if (window.opener) {
                    window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: 'Access Denied' }, '*');
                  }
                </script>
              </body>
            </html>
          `);
          return;
        }
      }

      // Store tokens in a secure cookie
      const isProduction = process.env.NODE_ENV === "production";
      res.cookie("google_tokens", JSON.stringify(tokens), {
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      // Send success message to parent window and close popup
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', tokens: ${JSON.stringify(tokens)} }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Error exchanging code for tokens:", error);
      res.status(500).send("Authentication failed");
    }
  });

  app.get("/api/auth/status", (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    
    if (authHeader && authHeader.startsWith("Bearer ")) {
      tokensCookie = decodeURIComponent(authHeader.split(" ")[1]);
    }

    if (tokensCookie) {
      res.json({ authenticated: true });
    } else {
      res.json({ authenticated: false });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const isProduction = process.env.NODE_ENV === "production";
    res.clearCookie("google_tokens", {
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      httpOnly: true,
    });
    res.json({ success: true });
  });

  app.post("/api/sheet", async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    
    if (authHeader && authHeader.startsWith("Bearer ")) {
      tokensCookie = decodeURIComponent(authHeader.split(" ")[1]);
    }

    if (!tokensCookie) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const sheetUrl = process.env.SHEET_URL || req.body.sheetUrl;
    if (!sheetUrl) {
      res.status(400).json({ error: "Missing SHEET_URL environment variable" });
      return;
    }

    // Extract Spreadsheet ID from URL
    const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const spreadsheetId = match ? match[1] : null;

    if (!spreadsheetId) {
      res.status(400).json({ error: "Invalid Google Sheet URL" });
      return;
    }

    try {
      const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
      const transactionsCollection = firestore.collection("transactions");
      const budgetsCollection = firestore.collection("budgets");

      const transactionsSnapshot = await transactionsCollection.get();
      const data = transactionsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      let headers: string[] = [];
      if (data.length > 0) {
        // Extract headers from the first document (ignoring the 'id' field we just added)
        headers = Object.keys(data[0]).filter(k => k !== 'id');
      }

      const budgetSnapshot = await budgetsCollection.get();
      const budgetData = budgetSnapshot.docs.map(doc => {
        const docData = doc.data();
        return {
          id: doc.id, // we can include id just in case
          "0": docData.Category,
          "1": docData.Amount,
        };
      });

      res.json({ data, headers, budgetData, budgetHeaders: [] });
    } catch (error: any) {
      console.error("Error fetching data from Firestore:", error);
      res.status(500).json({ error: error.message || "Failed to fetch data" });
    }
  });

  app.get("/api/migrate", async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    
    if (authHeader && authHeader.startsWith("Bearer ")) {
      tokensCookie = decodeURIComponent(authHeader.split(" ")[1]);
    }

    if (!tokensCookie) {
      res.status(401).json({ error: "Not authenticated. Please log in first." });
      return;
    }

    const sheetUrl = process.env.SHEET_URL;
    if (!sheetUrl) {
      res.status(400).json({ error: "Missing SHEET_URL environment variable" });
      return;
    }

    const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const spreadsheetId = match ? match[1] : null;

    if (!spreadsheetId) {
      res.status(400).json({ error: "Invalid Google Sheet URL" });
      return;
    }

    try {
      const tokens = JSON.parse(tokensCookie);
      const redirectUri = getRedirectUri(req);
      const oauth2Client = createOAuth2Client(redirectUri);
      oauth2Client.setCredentials(tokens);

      const sheets = google.sheets({ version: "v4", auth: oauth2Client });
      
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      
      let sheetName = "";
      const gidMatch = sheetUrl.match(/gid=([0-9]+)/);
      if (gidMatch && spreadsheet.data.sheets) {
        const gid = parseInt(gidMatch[1], 10);
        const sheet = spreadsheet.data.sheets.find((s) => s.properties?.sheetId === gid);
        if (sheet && sheet.properties?.title) {
          sheetName = sheet.properties.title;
        }
      }
      if (!sheetName && spreadsheet.data.sheets && spreadsheet.data.sheets.length > 0) {
        sheetName = spreadsheet.data.sheets[0].properties?.title || "";
      }

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: sheetName,
      });

      const rows = response.data.values;
      let data: any[] = [];
      let headers: string[] = [];
      if (rows && rows.length > 0) {
        headers = rows[0];
        data = rows.slice(1).map((row) => {
          const obj: Record<string, any> = {};
          headers.forEach((header, index) => {
            obj[header] = row[index] !== undefined ? row[index] : null;
          });
          return obj;
        });
      }

      let budgetData: any[] = [];
      const budgetSheet = spreadsheet.data.sheets?.find(
        (s) => s.properties?.title?.toLowerCase() === "budget"
      );

      if (budgetSheet && budgetSheet.properties?.title) {
        const budgetResponse = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: budgetSheet.properties.title,
        });
        
        const budgetRows = budgetResponse.data.values;
        if (budgetRows && budgetRows.length > 0) {
          budgetData = budgetRows.map((row) => {
            const obj: Record<string, any> = {};
            row.forEach((cell, index) => {
              obj[index] = cell !== undefined ? cell : null;
            });
            return obj;
          });
        }
      }

      const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
      const transactionsCollection = firestore.collection("transactions");
      const budgetsCollection = firestore.collection("budgets");

      // Write transactions
      let transactionsCount = 0;
      for (const item of data) {
        await transactionsCollection.add(item);
        transactionsCount++;
      }

      // Write budgets
      let budgetsCount = 0;
      for (const item of budgetData) {
        // budgetData objects have numeric string keys like "0": category, "1": amount
        const category = item["0"];
        const amount = item["1"];
        if (category) {
          await budgetsCollection.add({
            Category: category,
            Amount: amount,
          });
          budgetsCount++;
        }
      }

      res.json({ 
        success: true, 
        message: `Successfully migrated ${transactionsCount} transactions and ${budgetsCount} budget items to Firestore.` 
      });
    } catch (error: any) {
      console.error("Error migrating to Firestore:", error);
      res.status(500).json({ error: error.message || "Failed to migrate data" });
    }
  });

  app.post("/api/budget/update", async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    
    if (authHeader && authHeader.startsWith("Bearer ")) {
      tokensCookie = decodeURIComponent(authHeader.split(" ")[1]);
    }

    if (!tokensCookie) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const { category, amount } = req.body;
    if (!category || amount === undefined) {
      res.status(400).json({ error: "Missing category or amount" });
      return;
    }

    try {
      const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
      const budgetsCollection = firestore.collection("budgets");

      const querySnapshot = await budgetsCollection.where("Category", "==", category).get();
      
      if (querySnapshot.empty) {
        await budgetsCollection.add({ Category: category, Amount: amount });
      } else {
        const docId = querySnapshot.docs[0].id;
        await budgetsCollection.doc(docId).update({ Amount: amount });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating budget:", error);
      res.status(500).json({ error: error.message || "Failed to update budget" });
    }
  });

  app.post("/api/transaction/update", async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    
    if (authHeader && authHeader.startsWith("Bearer ")) {
      tokensCookie = decodeURIComponent(authHeader.split(" ")[1]);
    }

    if (!tokensCookie) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const { id, amount, category, subcategory } = req.body;
    if (!id || amount === undefined || !category) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    try {
      const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
      const transactionsCollection = firestore.collection("transactions");

      const updates: Record<string, any> = { Amount: amount, Category: category };
      if (subcategory !== undefined) {
        updates.Subcategory = subcategory;
      }

      await transactionsCollection.doc(id).update(updates);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating transaction:", error);
      res.status(500).json({ error: error.message || "Failed to update transaction" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
