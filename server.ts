import express from "express";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import { google } from "googleapis";
import path from "path";
import dotenv from "dotenv";
import { Firestore } from "@google-cloud/firestore";
import { GoogleGenAI } from "@google/genai";
import { deduplicateTransactions, exactMatchTransactions, generateSignature } from "./src/utils/importLogic.js";

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

  app.post("/api/import", async (req, res) => {
    console.log(`\n[Server] POST /api/import received`);
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    
    if (authHeader && authHeader.startsWith("Bearer ")) {
      tokensCookie = decodeURIComponent(authHeader.split(" ")[1]);
    }

    if (!tokensCookie) {
      console.warn("[Server] POST /api/import: Not authenticated");
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const { transactions, filename } = req.body;
    console.log(`[Server] Import request for file: ${filename}, payload size: ${transactions?.length} transactions`);
    
    if (!transactions || !Array.isArray(transactions)) {
      console.error("[Server] Invalid payload received:", req.body);
      res.status(400).json({ error: "Invalid payload" });
      return;
    }

    try {
      const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
      const transactionsCollection = firestore.collection("transactions");
      const importsCollection = firestore.collection("imports");

      // 1. Fetch existing transactions to build deduplication set and exact match dictionary
      const snapshot = await transactionsCollection.get();
      const existingSignatures = new Set<string>();
      const knownMapping: Record<string, { Category: string; Subcategory: string }> = {};

      snapshot.docs.forEach(doc => {
        const data = doc.data();
        existingSignatures.add(generateSignature(data));
        if (data.Description && data.Category) {
          knownMapping[data.Description] = { 
            Category: data.Category, 
            Subcategory: data.Subcategory || "" 
          };
        }
      });

      // 2. Deduplicate incoming
      const uniqueIncoming = deduplicateTransactions(transactions, existingSignatures);

      if (uniqueIncoming.length === 0) {
        res.json({ success: true, message: "No new transactions to import. All were duplicates." });
        return;
      }

      // 3. Exact matching
      const { exactMatches, fuzzyMatches } = exactMatchTransactions(uniqueIncoming, knownMapping);

      // 4. Fuzzy matching via Gemini
      let finalFuzzyMatches = [...fuzzyMatches];
      let geminiErrorMessage = "";
      
      console.log(`[Server] Pre-Gemini stats: ${exactMatches.length} exact matches, ${fuzzyMatches.length} fuzzy matches to process`);
      
      if (fuzzyMatches.length > 0 && process.env.GEMINI_API_KEY) {
        try {
          console.log("[Server] Calling Gemini for fuzzy matches...");
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          
          // Get unique descriptions to fuzzy match
          const uniqueFuzzyDescs = Array.from(new Set(fuzzyMatches.map(tx => tx.Description || ""))).filter(Boolean);
          console.log(`[Server] Found ${uniqueFuzzyDescs.length} unique descriptions to ask Gemini`);
          
          if (uniqueFuzzyDescs.length > 0) {
            // Provide the known mapping as examples
            const examplesStr = JSON.stringify(knownMapping);
            const prompt = `You are an expert financial categorizer.
Here is a JSON dictionary of my historically categorized transactions (Description -> Category/Subcategory):
${examplesStr}

Please categorize the following new transaction descriptions based on my historical patterns. Return ONLY a valid JSON object where keys are the descriptions and values are objects with "Category" and "Subcategory" strings. Make your best educated guess for new merchants.
New descriptions:
${JSON.stringify(uniqueFuzzyDescs)}
`;

            console.log("[Server] Waiting for Gemini response...");
            const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: prompt,
            });

            const text = response.text || "";
            console.log(`[Server] Received Gemini response (length: ${text.length})`);
            
            // Extract JSON from response (handling potential markdown code blocks)
            const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/{[\s\S]*}/);
            if (jsonMatch) {
              const parsedText = jsonMatch[1] || jsonMatch[0];
              console.log("[Server] Successfully extracted JSON from Gemini response");
              const predictions = JSON.parse(parsedText);
              
              // Apply predictions
              finalFuzzyMatches = fuzzyMatches.map(tx => {
                const desc = tx.Description || "";
                const pred = predictions[desc];
                if (pred) {
                  return {
                    ...tx,
                    Category: pred.Category,
                    Subcategory: pred.Subcategory,
                    status: "pending_review"
                  };
                }
                return { ...tx, status: "pending_review" };
              });
            } else {
              finalFuzzyMatches = fuzzyMatches.map(tx => ({ ...tx, status: "pending_review" }));
            }
          }
        } catch (geminiErr: any) {
          console.error("Gemini fuzzy matching failed:", geminiErr);
          geminiErrorMessage = geminiErr?.message || "Gemini categorization failed";
          // Fallback if Gemini fails
          finalFuzzyMatches = fuzzyMatches.map(tx => ({ ...tx, status: "pending_review" }));
        }
      } else if (!process.env.GEMINI_API_KEY) {
        geminiErrorMessage = "No Gemini API key configured — categories could not be auto-predicted.";
        // No Gemini key, just mark as pending review
        finalFuzzyMatches = fuzzyMatches.map(tx => ({ ...tx, status: "pending_review" }));
      } else {
        finalFuzzyMatches = fuzzyMatches.map(tx => ({ ...tx, status: "pending_review" }));
      }

      const allToInsert = [...exactMatches, ...finalFuzzyMatches];
      const importId = `import_${Date.now()}`;

      // Write import record
      await importsCollection.doc(importId).set({
        importId,
        date: new Date().toISOString(),
        filename: filename || "Unknown file",
        count: allToInsert.length
      });

      // Write transactions in batches
      const batchSize = 400; // Firestore limit is 500
      for (let i = 0; i < allToInsert.length; i += batchSize) {
        const batch = firestore.batch();
        const chunk = allToInsert.slice(i, i + batchSize);
        
        chunk.forEach(tx => {
          const docRef = transactionsCollection.doc();
          batch.set(docRef, { ...tx, importId });
        });
        
        await batch.commit();
      }

      const responsePayload: any = { 
        success: true, 
        message: `Imported ${allToInsert.length} transactions. ${exactMatches.length} auto-categorized, ${finalFuzzyMatches.length} pending review.` 
      };
      if (geminiErrorMessage) {
        responsePayload.geminiError = `Gemini categorization was skipped: ${geminiErrorMessage}`;
      }
      
      console.log(`[Server] /api/import complete. Returning success payload.`);
      res.json(responsePayload);
    } catch (error: any) {
      console.error("[Server] Error processing import:", error);
      res.status(500).json({ error: error.message || "Failed to process import" });
    }
  });

  app.post("/api/import/rollback", async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith("Bearer ")) tokensCookie = decodeURIComponent(authHeader.split(" ")[1]);
    if (!tokensCookie) return res.status(401).json({ error: "Not authenticated" });

    const { importId } = req.body;
    if (!importId) return res.status(400).json({ error: "Missing importId" });

    try {
      const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
      const transactionsCollection = firestore.collection("transactions");
      const importsCollection = firestore.collection("imports");

      const snapshot = await transactionsCollection.where("importId", "==", importId).get();
      
      const batchSize = 400;
      for (let i = 0; i < snapshot.docs.length; i += batchSize) {
        const batch = firestore.batch();
        const chunk = snapshot.docs.slice(i, i + batchSize);
        chunk.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }

      await importsCollection.doc(importId).delete();

      res.json({ success: true, deletedCount: snapshot.docs.length });
    } catch (err: any) {
      console.error("Rollback failed:", err);
      res.status(500).json({ error: err.message || "Rollback failed" });
    }
  });

  app.get("/api/imports", async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith("Bearer ")) tokensCookie = decodeURIComponent(authHeader.split(" ")[1]);
    if (!tokensCookie) return res.status(401).json({ error: "Not authenticated" });

    try {
      const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
      const snapshot = await firestore.collection("imports").orderBy("date", "desc").get();
      const imports = snapshot.docs.map(doc => doc.data());
      res.json({ imports });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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

    const { id, amount, category, subcategory, status } = req.body;
    if (!id || amount === undefined || !category) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    try {
      const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
      const transactionsCollection = firestore.collection("transactions");

      const updatesObj: Record<string, any> = { Amount: amount, Category: category };
      if (subcategory !== undefined) {
        updatesObj.Subcategory = subcategory;
      }
      if (status !== undefined) {
        updatesObj.status = status;
      }

      await transactionsCollection.doc(id).update(updatesObj);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating transaction:", error);
      res.status(500).json({ error: error.message || "Failed to update transaction" });
    }
  });

  // Bulk update endpoint
  app.post("/api/transaction/bulk-update", async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      tokensCookie = decodeURIComponent(authHeader.split(" ")[1]);
    }
    if (!tokensCookie) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const { updates } = req.body;
    if (!Array.isArray(updates)) {
      res.status(400).json({ error: "Missing updates array" });
      return;
    }

    try {
      const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
      const batchSize = 400;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = firestore.batch();
        const chunk = updates.slice(i, i + batchSize);
        chunk.forEach((update: any) => {
          const ref = firestore.collection("transactions").doc(update.id);
          const data: any = {};
          if (update.Category !== undefined) data.Category = update.Category;
          if (update.Subcategory !== undefined) data.Subcategory = update.Subcategory;
          if (update.status !== undefined) data.status = update.status;
          batch.update(ref, data);
        });
        await batch.commit();
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error in bulk update:", error);
      res.status(500).json({ error: error.message || "Failed to bulk update" });
    }
  });

  // Taxonomy management endpoints
  app.get("/api/taxonomy", async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith("Bearer ")) tokensCookie = decodeURIComponent(authHeader.split(" ")[1]);
    if (!tokensCookie) return res.status(401).json({ error: "Not authenticated" });

    try {
      const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
      const doc = await firestore.collection("taxonomy").doc("global").get();
      if (!doc.exists) {
        res.json({ taxonomy: {} });
      } else {
        res.json({ taxonomy: doc.data()?.mapping || {} });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/taxonomy/init", async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith("Bearer ")) tokensCookie = decodeURIComponent(authHeader.split(" ")[1]);
    if (!tokensCookie) return res.status(401).json({ error: "Not authenticated" });

    try {
      const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
      const transactionsSnapshot = await firestore.collection("transactions").get();
      
      const taxonomy: Record<string, string[]> = {};
      
      transactionsSnapshot.docs.forEach(doc => {
          const data = doc.data();
          if (data.Category) {
              const cat = data.Category;
              const subcat = data.Subcategory;
              
              if (!taxonomy[cat]) {
                  taxonomy[cat] = [];
              }
              if (subcat && !taxonomy[cat].includes(subcat)) {
                  taxonomy[cat].push(subcat);
              }
          }
      });
      
      // Sort the arrays for neatness
      Object.keys(taxonomy).forEach(cat => {
        taxonomy[cat].sort();
      });

      await firestore.collection("taxonomy").doc("global").set({ mapping: taxonomy });
      res.json({ success: true, taxonomy });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/taxonomy/update", async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith("Bearer ")) tokensCookie = decodeURIComponent(authHeader.split(" ")[1]);
    if (!tokensCookie) return res.status(401).json({ error: "Not authenticated" });

    try {
      const { taxonomy } = req.body;
      const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
      await firestore.collection("taxonomy").doc("global").set({ mapping: taxonomy });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/taxonomy/check-usage", async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith("Bearer ")) tokensCookie = decodeURIComponent(authHeader.split(" ")[1]);
    if (!tokensCookie) return res.status(401).json({ error: "Not authenticated" });

    try {
      const { category, subcategory } = req.body;
      const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
      let query = firestore.collection("transactions").where("Category", "==", category);
      if (subcategory) {
          query = query.where("Subcategory", "==", subcategory);
      }
      const snapshot = await query.limit(1).get();
      res.json({ inUse: !snapshot.empty });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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
