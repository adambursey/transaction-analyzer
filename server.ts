import express from "express";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import { google } from "googleapis";
import path from "path";
import dotenv from "dotenv";

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
  const PORT = 3000;

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
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/userinfo.profile",
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

      // Store tokens in a secure cookie
      res.cookie("google_tokens", JSON.stringify(tokens), {
        secure: true,
        sameSite: "none",
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
    res.clearCookie("google_tokens", {
      secure: true,
      sameSite: "none",
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
      const tokens = JSON.parse(tokensCookie);
      const redirectUri = getRedirectUri(req);
      const oauth2Client = createOAuth2Client(redirectUri);
      oauth2Client.setCredentials(tokens);

      const sheets = google.sheets({ version: "v4", auth: oauth2Client });
      
      // First, get the spreadsheet metadata to find the sheet name
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId,
      });

      // Find the sheet name based on gid if provided in URL
      let sheetName = "";
      const gidMatch = sheetUrl.match(/gid=([0-9]+)/);
      if (gidMatch && spreadsheet.data.sheets) {
        const gid = parseInt(gidMatch[1], 10);
        const sheet = spreadsheet.data.sheets.find(
          (s) => s.properties?.sheetId === gid
        );
        if (sheet && sheet.properties?.title) {
          sheetName = sheet.properties.title;
        }
      }

      // If no gid or not found, use the first sheet
      if (!sheetName && spreadsheet.data.sheets && spreadsheet.data.sheets.length > 0) {
        sheetName = spreadsheet.data.sheets[0].properties?.title || "";
      }

      if (!sheetName) {
        res.status(400).json({ error: "Could not determine sheet name" });
        return;
      }

      // Get the data from the main sheet
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

      // Try to get data from "Budget" sheet
      let budgetData: any[] = [];
      let budgetHeaders: string[] = [];
      
      const budgetSheet = spreadsheet.data.sheets?.find(
        (s) => s.properties?.title?.toLowerCase() === "budget"
      );

      if (budgetSheet && budgetSheet.properties?.title) {
        try {
          const budgetResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: budgetSheet.properties.title,
          });
          
          const budgetRows = budgetResponse.data.values;
          if (budgetRows && budgetRows.length > 0) {
            // Include ALL rows, including the first one, as budget sheets often don't have headers
            budgetData = budgetRows.map((row) => {
              const obj: Record<string, any> = {};
              row.forEach((cell, index) => {
                obj[index] = cell !== undefined ? cell : null;
              });
              return obj;
            });
          }
        } catch (budgetErr) {
          console.error("Error fetching budget sheet:", budgetErr);
          // Don't fail the whole request if budget fails
        }
      }

      res.json({ data, headers, budgetData, budgetHeaders });
    } catch (error: any) {
      console.error("Error fetching sheet:", error);
      res.status(500).json({ error: error.message || "Failed to fetch sheet data" });
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
      const oauth2Client = createOAuth2Client(getRedirectUri(req));
      oauth2Client.setCredentials(tokens);

      const sheets = google.sheets({ version: "v4", auth: oauth2Client });
      
      // Find the Budget sheet
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const budgetSheet = spreadsheet.data.sheets?.find(
        (s) => s.properties?.title?.toLowerCase() === "budget"
      );

      if (!budgetSheet || !budgetSheet.properties?.title) {
        res.status(404).json({ error: "Budget sheet not found" });
        return;
      }

      const sheetName = budgetSheet.properties.title;

      // Get current budget data to find the row
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: sheetName,
      });

      const rows = response.data.values || [];
      let rowIndex = -1;

      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] && String(rows[i][0]).toLowerCase() === category.toLowerCase()) {
          rowIndex = i;
          break;
        }
      }

      if (rowIndex !== -1) {
        // Update existing row
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!B${rowIndex + 1}`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[amount]],
          },
        });
      } else {
        // Append new row
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${sheetName}!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[category, amount]],
          },
        });
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

    const { rowIndex, amount, category, subcategory, columnIndices } = req.body;
    if (rowIndex === undefined || amount === undefined || !category || !columnIndices) {
      res.status(400).json({ error: "Missing required fields" });
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
      const oauth2Client = createOAuth2Client(getRedirectUri(req));
      oauth2Client.setCredentials(tokens);

      const sheets = google.sheets({ version: "v4", auth: oauth2Client });
      
      // Get the spreadsheet metadata to find the sheet name
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      
      let sheetName = "";
      const gidMatch = sheetUrl.match(/gid=([0-9]+)/);
      if (gidMatch && spreadsheet.data.sheets) {
        const gid = parseInt(gidMatch[1], 10);
        const sheet = spreadsheet.data.sheets.find(
          (s) => s.properties?.sheetId === gid
        );
        if (sheet && sheet.properties?.title) {
          sheetName = sheet.properties.title;
        }
      }
      if (!sheetName && spreadsheet.data.sheets && spreadsheet.data.sheets.length > 0) {
        sheetName = spreadsheet.data.sheets[0].properties?.title || "";
      }

      if (!sheetName) {
        res.status(400).json({ error: "Could not determine sheet name" });
        return;
      }

      // Update cells
      // rowIndex is 0-based from the data (excluding header)
      // Spreadsheet row is rowIndex + 2
      const spreadsheetRow = rowIndex + 2;
      
      const updates = [];
      
      // Amount
      if (columnIndices.amount !== -1) {
        const amountColLetter = indexToColumn(columnIndices.amount);
        updates.push({
          range: `${sheetName}!${amountColLetter}${spreadsheetRow}`,
          values: [[amount]],
        });
      }
      
      // Category
      if (columnIndices.category !== -1) {
        const categoryColLetter = indexToColumn(columnIndices.category);
        updates.push({
          range: `${sheetName}!${categoryColLetter}${spreadsheetRow}`,
          values: [[category]],
        });
      }
      
      // Subcategory
      if (columnIndices.subcategory !== -1) {
        const subcategoryColLetter = indexToColumn(columnIndices.subcategory);
        updates.push({
          range: `${sheetName}!${subcategoryColLetter}${spreadsheetRow}`,
          values: [[subcategory]],
        });
      }

      if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: updates,
          },
        });
      }

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
