/**
 * @file server.ts
 * @description Main Express server application that handles API routing, Google OAuth2 authentication,
 * and Firestore database interactions. Serves the Vite frontend in development and static files in production.
 */

import express from 'express';
import { createServer as createViteServer } from 'vite';
import cookieParser from 'cookie-parser';
import { google } from 'googleapis';
import path from 'path';
import dotenv from 'dotenv';
import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';
import { GoogleGenAI } from '@google/genai';
import {
  deduplicateTransactions,
  exactMatchTransactions,
  generateSignature,
  areTransactionsTheSame,
} from './src/utils/importLogic.js';

dotenv.config();

/**
 * Parses various date formats into a strict Date object set to noon (12:00:00) to avoid timezone issues.
 * Supports native Dates, Firestore Timestamps, and common string formats (YYYY-MM-DD, MM/DD/YYYY).
 *
 * @param dateStr - The raw date value to parse.
 * @returns A parsed Date object set to noon, or null if parsing fails.
 */
function parseStrictDate(dateStr: any): Date | null {
  if (!dateStr) return null;
  if (dateStr instanceof Date)
    return new Date(dateStr.getFullYear(), dateStr.getMonth(), dateStr.getDate(), 12, 0, 0, 0);
  if (typeof dateStr.toDate === 'function') {
    const d = dateStr.toDate();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  }
  if (dateStr._seconds) {
    const d = new Date(dateStr._seconds * 1000);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  }

  const str = String(dateStr).trim();
  // If it's already a YYYY-MM-DD string
  if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [y, m, d] = str.split('-');
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d), 12, 0, 0, 0);
  }
  // If it's a MM/DD/YYYY string
  const parts = str.split(/[/-]/);
  if (parts.length === 3) {
    let year, month, day;
    if (parts[0].length === 4) {
      // YYYY/MM/DD
      year = parseInt(parts[0]);
      month = parseInt(parts[1]) - 1;
      day = parseInt(parts[2]);
    } else {
      // MM/DD/YYYY
      month = parseInt(parts[0]) - 1;
      day = parseInt(parts[1]);
      year = parseInt(parts[2]);
      if (year < 100) year += 2000;
    }
    const d = new Date(year, month, day, 12, 0, 0, 0);
    if (!isNaN(d.getTime())) return d;
  }

  const fallback = new Date(str);
  if (!isNaN(fallback.getTime())) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate(), 12, 0, 0, 0);
  }
  return null;
}

/**
 * Converts a zero-based index to an Excel-style column letter (e.g., 0 -> A, 25 -> Z, 26 -> AA).
 *
 * @param index - The zero-based column index.
 * @returns The corresponding column letter.
 */

/**
 * Initializes and starts the Express server.
 * Sets up middleware, defines API routes, and handles Vite SSR/static file serving.
 */
/**
 * Creates and configures the Express application.
 * Separated from startServer to allow for easy testing with Supertest without binding to a port.
 * @returns The configured Express application.
 */
/**
 * Utility to sync and remove deleted transaction IDs from example lists of any recurring transaction.
 *
 * @param firestore - The Firestore database instance.
 * @param txIds - Array of transaction IDs that are being deleted.
 */
export async function removeTransactionIdsFromRecurringExamples(
  firestore: Firestore,
  txIds: string[]
) {
  if (txIds.length === 0) return;
  try {
    const recurringCollection = firestore.collection('recurring_transactions');
    const snapshot = await recurringCollection.get();
    if (snapshot.empty) return;

    const batch = firestore.batch();
    let opsCount = 0;

    // Iterate through all recurring profiles and filter out deleted transaction IDs
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const exampleIds = data.exampleTransactionIds || [];
      const filteredIds = exampleIds.filter((id: string) => !txIds.includes(id));

      // If any IDs were filtered out, queue an update
      if (filteredIds.length !== exampleIds.length) {
        batch.update(doc.ref, { exampleTransactionIds: filteredIds });
        opsCount++;
      }
    }

    if (opsCount > 0) {
      await batch.commit();
      console.log(
        `[Recurring Sync] Removed deleted transactions from ${opsCount} recurring example lists.`
      );
    }
  } catch (err) {
    console.error(
      '[Recurring Sync] Error syncing deleted transactions with recurring examples:',
      err
    );
  }
}

/**
 * One-time startup cleanup utility to remove any stale example transaction IDs
 * that no longer exist in the database from all recurring profiles.
 */
export async function cleanStaleRecurringExamplesOnStartup() {
  try {
    const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
    const recurringCollection = firestore.collection('recurring_transactions');
    const transactionsCollection = firestore.collection('transactions');

    const recurringSnapshot = await recurringCollection.get();
    if (recurringSnapshot.empty) return;

    // Fetch all existing transaction documents to build a set of active/non-archived IDs
    const txSnapshot = await transactionsCollection.get();
    const validTxIds = new Set(
      txSnapshot.docs.filter((doc) => doc.data().status !== 'archived').map((doc) => doc.id)
    );

    const batch = firestore.batch();
    let updatedCount = 0;

    // Filter out transaction IDs that are no longer active in the database
    for (const doc of recurringSnapshot.docs) {
      const data = doc.data();
      const exampleIds = data.exampleTransactionIds || [];
      const filteredIds = exampleIds.filter((id: string) => validTxIds.has(id));

      if (filteredIds.length !== exampleIds.length) {
        batch.update(doc.ref, { exampleTransactionIds: filteredIds });
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      await batch.commit();
      console.log(
        `[Startup Cleanup] Cleaned stale example transaction IDs from ${updatedCount} recurring profiles.`
      );
    } else {
      console.log(`[Startup Cleanup] No stale example transaction IDs found.`);
    }
  } catch (err) {
    console.error('[Startup Cleanup] Failed to run stale examples cleanup:', err);
  }
}

export async function createApp() {
  const app = express();

  app.use(cookieParser());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // API routes FIRST
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  const getRedirectUri = (req: express.Request) => {
    // In preview environment, use APP_URL if available, otherwise fallback to request origin
    const appUrl = process.env.APP_URL;
    if (appUrl) {
      return `${appUrl}/auth/callback`;
    }
    return `${req.protocol}://${req.get('host')}/auth/callback`;
  };

  const createOAuth2Client = (redirectUri: string) => {
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
  };

  app.get('/api/auth/url', (req, res) => {
    const redirectUri = req.query.redirectUri as string;
    if (!redirectUri) {
      res.status(400).json({ error: 'Missing redirectUri' });
      return;
    }
    const oauth2Client = createOAuth2Client(redirectUri);

    const scopes = [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      state: encodeURIComponent(redirectUri),
    });

    res.json({ url });
  });

  app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
    const { code, state } = req.query;
    if (!code || typeof code !== 'string') {
      res.status(400).send('Missing code');
      return;
    }

    // We need the redirectUri to exchange the code.
    // We can pass it via the state parameter.
    const redirectUri = state ? decodeURIComponent(state as string) : getRedirectUri(req);

    try {
      const oauth2Client = createOAuth2Client(redirectUri);
      const { tokens } = await oauth2Client.getToken(code);

      // Verify email against allowed list from environment variables
      oauth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({
        auth: oauth2Client,
        version: 'v2',
      });
      const userInfo = await oauth2.userinfo.get();
      const userEmail = userInfo.data.email;

      if (process.env.ALLOWED_EMAILS) {
        const allowedEmails = process.env.ALLOWED_EMAILS.split(',').map((e) =>
          e.trim().toLowerCase()
        );
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
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie('google_tokens', JSON.stringify(tokens), {
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
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
      console.error('Error exchanging code for tokens:', error);
      res.status(500).send('Authentication failed');
    }
  });

  app.get('/api/auth/status', (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    }

    if (tokensCookie) {
      res.json({ authenticated: true });
    } else {
      res.json({ authenticated: false });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('google_tokens', {
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      httpOnly: true,
    });
    res.json({ success: true });
  });

  app.post('/api/import', async (req, res) => {
    console.log(`\n[Server] POST /api/import received`);
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    }

    if (!tokensCookie) {
      console.warn('[Server] POST /api/import: Not authenticated');
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const {
      transactions,
      filename,
      importId: clientImportId,
      useSavedMapping,
      account: targetAccount,
    } = req.body;
    const accountStr = targetAccount || 'Checking';
    console.log(
      `[Server] Import request for file: ${filename}, payload size: ${transactions?.length} transactions, account: ${accountStr}`
    );

    if (!transactions || !Array.isArray(transactions)) {
      console.error('[Server] Invalid payload received:', req.body);
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }

    try {
      const firestore = new Firestore({
        projectId: 'tx-analyzer-1777844550',
        ignoreUndefinedProperties: true,
      });
      const transactionsCollection = firestore.collection('transactions');
      const importsCollection = firestore.collection('imports');

      let currentDayStr = '';
      let intradayIndex = 0;

      const parsedTransactions = transactions.map((tx: any) => {
        if (tx.Date !== currentDayStr) {
          currentDayStr = tx.Date;
          intradayIndex = 0;
        }
        intradayIndex++;

        const d = parseStrictDate(tx.Date);
        if (d) {
          d.setSeconds(d.getSeconds() - intradayIndex);
        }

        const parsedAmount =
          typeof tx.Amount === 'string'
            ? parseFloat(tx.Amount.replace(/[^0-9.-]+/g, ''))
            : Number(tx.Amount || 0);
        let parsedBalance = undefined;
        if (tx.Balance !== undefined && tx.Balance !== null && tx.Balance !== '') {
          parsedBalance =
            typeof tx.Balance === 'string'
              ? parseFloat(tx.Balance.toString().replace(/[^0-9.-]+/g, ''))
              : Number(tx.Balance);
        }

        return {
          ...tx,
          Date: d ? Timestamp.fromDate(d) : null,
          Amount: isNaN(parsedAmount) ? 0 : parsedAmount,
          Balance:
            parsedBalance === undefined || isNaN(parsedBalance as number) ? null : parsedBalance,
          Account: accountStr,
          matched: false,
          createdAt: Timestamp.now(),
        };
      });

      // 1. Fetch existing transactions to build deduplication set and exact match dictionary
      const snapshot = await transactionsCollection.get();
      const existingSignatures = new Set<string>();
      let knownMapping: Record<string, { Category: string; Subcategory: string }> = {};

      if (useSavedMapping) {
        const savedDoc = await firestore.collection('admin').doc('saved_mapping').get();
        if (savedDoc.exists) {
          knownMapping = savedDoc.data()?.mapping || {};
        }
      }

      const existingDateAmountMap = new Map<string, { id: string; tx: any }>();

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const sig = generateSignature(data);
        existingSignatures.add(sig);

        // Map Account+Date+Amount to document ID and description for potential duplicate checking
        const parts = sig.split('|');
        if (parts.length >= 4) {
          const dateAmountKey = `${parts[0]}|${parts[1]}|${parts[3]}`;
          // If there are multiple identical date+amount txs, this just stores the last one.
          // That's acceptable for a "potential duplicate" flag anchor.
          existingDateAmountMap.set(dateAmountKey, {
            id: doc.id,
            tx: data,
          });
        }

        if (
          !useSavedMapping &&
          data.Description &&
          data.Category &&
          data.Category !== 'Uncategorized'
        ) {
          knownMapping[data.Description] = {
            Category: data.Category,
            Subcategory: data.Subcategory || '',
          };
        }
      });

      // 2. Deduplicate incoming transactions by comparing generated signatures against the database
      const uniqueIncoming = deduplicateTransactions(parsedTransactions, existingSignatures);

      if (uniqueIncoming.length === 0) {
        res.json({
          success: true,
          message: 'No new transactions to import. All were duplicates.',
          importedCount: 0,
          skippedCount: parsedTransactions.length,
        });
        return;
      }

      // 3. Identify potential duplicates (same date + amount, but different description)
      const potentialDuplicates: any[] = [];
      const trueNewIncoming: any[] = [];

      for (const tx of uniqueIncoming) {
        const sig = generateSignature(tx);
        const parts = sig.split('|');
        if (parts.length >= 4) {
          const dateAmountKey = `${parts[0]}|${parts[1]}|${parts[3]}`;
          const existingMatch = existingDateAmountMap.get(dateAmountKey);

          let isPotentialDupe = false;
          if (existingMatch) {
            const matchResult = areTransactionsTheSame(tx, existingMatch.tx);
            if (matchResult.isMatch && matchResult.matchType === 'fuzzy') {
              isPotentialDupe = true;
            }
          }

          if (isPotentialDupe && existingMatch) {
            potentialDuplicates.push({
              ...tx,
              status: 'potential_duplicate',
              duplicateOfId: existingMatch.id,
            });
          } else {
            trueNewIncoming.push(tx);
          }
        } else {
          trueNewIncoming.push(tx);
        }
      }

      // 4. Exact matching
      const { exactMatches, fuzzyMatches } = exactMatchTransactions(trueNewIncoming, knownMapping);

      // 5. Fuzzy matching via Gemini
      let finalFuzzyMatches = [...fuzzyMatches];
      let geminiErrorMessage = '';

      console.log(
        `[Server] Pre-Gemini stats: ${exactMatches.length} exact matches, ${fuzzyMatches.length} fuzzy matches to process`
      );

      // Fetch taxonomy for strict validation
      const taxonomyDoc = await firestore.collection('taxonomy').doc('global').get();
      const globalTaxonomy = taxonomyDoc.exists ? taxonomyDoc.data()?.mapping || {} : {};

      if (fuzzyMatches.length > 0 && process.env.GEMINI_API_KEY) {
        try {
          console.log('[Server] Calling Gemini for fuzzy matches...');
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

          // Get unique descriptions to fuzzy match
          const uniqueFuzzyDescs = Array.from(
            new Set(fuzzyMatches.map((tx) => tx.Description || ''))
          ).filter(Boolean);
          console.log(
            `[Server] Found ${uniqueFuzzyDescs.length} unique descriptions to ask Gemini`
          );

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

            console.log('[Server] Waiting for Gemini response...');
            const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: prompt,
            });

            const text = response.text || '';
            console.log(`[Server] Received Gemini response (length: ${text.length})`);

            // Extract JSON from response (handling potential markdown code blocks)
            const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/{[\s\S]*}/);
            if (jsonMatch) {
              const parsedText = jsonMatch[1] || jsonMatch[0];
              console.log('[Server] Successfully extracted JSON from Gemini response');
              const predictions = JSON.parse(parsedText);

              // Apply predictions
              finalFuzzyMatches = fuzzyMatches.map((tx) => {
                const desc = tx.Description || '';
                const pred = predictions[desc];
                if (pred) {
                  let validCat = pred.Category;
                  let validSubcat = pred.Subcategory;

                  // Strict validation
                  if (validCat && !globalTaxonomy[validCat]) {
                    validCat = '';
                    validSubcat = '';
                  } else if (
                    validCat &&
                    validSubcat &&
                    !globalTaxonomy[validCat].includes(validSubcat)
                  ) {
                    validSubcat = '';
                  }

                  return {
                    ...tx,
                    Category: validCat || '',
                    Subcategory: validSubcat || '',
                    status: 'pending_review',
                  };
                }
                return { ...tx, status: 'pending_review' };
              });
            } else {
              finalFuzzyMatches = fuzzyMatches.map((tx) => ({ ...tx, status: 'pending_review' }));
            }
          }
        } catch (geminiErr: any) {
          console.error('Gemini fuzzy matching failed:', geminiErr);
          geminiErrorMessage = geminiErr?.message || 'Gemini categorization failed';
          // Fallback if Gemini fails
          finalFuzzyMatches = fuzzyMatches.map((tx) => ({ ...tx, status: 'pending_review' }));
        }
      } else if (!process.env.GEMINI_API_KEY) {
        geminiErrorMessage =
          'No Gemini API key configured — categories could not be auto-predicted.';
        // No Gemini key, just mark as pending review
        finalFuzzyMatches = fuzzyMatches.map((tx) => ({ ...tx, status: 'pending_review' }));
      } else {
        finalFuzzyMatches = fuzzyMatches.map((tx) => ({ ...tx, status: 'pending_review' }));
      }

      const allToInsert = [...exactMatches, ...finalFuzzyMatches, ...potentialDuplicates];
      const importId = clientImportId || `import_${Date.now()}`;

      // Write import record
      const importRef = importsCollection.doc(importId);

      // We use set({ merge: true }) with FieldValue.increment to avoid race conditions
      // from multiple chunks updating the count concurrently.
      await importRef.set(
        {
          importId,
          date: new Date().toISOString(),
          filename: filename || 'Unknown file',
          account: accountStr,
          count: FieldValue.increment(allToInsert.length),
        },
        { merge: true }
      );

      // Write transactions in batches
      const batchSize = 400; // Firestore limit is 500
      for (let i = 0; i < allToInsert.length; i += batchSize) {
        const batch = firestore.batch();
        const chunk = allToInsert.slice(i, i + batchSize);

        chunk.forEach((tx) => {
          const docRef = transactionsCollection.doc();

          // Sanitize transaction to ensure no undefined values are written to Firestore
          const sanitizedTx: any = {};
          Object.keys(tx).forEach((key) => {
            sanitizedTx[key] = tx[key] === undefined ? null : tx[key];
          });
          if (sanitizedTx.Balance === undefined) {
            sanitizedTx.Balance = null;
          }

          batch.set(docRef, { ...sanitizedTx, importId });
        });

        await batch.commit();
      }

      const skippedCount = parsedTransactions.length - uniqueIncoming.length;
      const responsePayload: any = {
        success: true,
        message: `Imported ${allToInsert.length} transactions. ${exactMatches.length} auto-categorized, ${finalFuzzyMatches.length} pending review. Skipped ${skippedCount} duplicates.`,
        importedCount: allToInsert.length,
        skippedCount: skippedCount,
      };
      if (geminiErrorMessage) {
        responsePayload.geminiError = `Gemini categorization was skipped: ${geminiErrorMessage}`;
      }

      console.log(`[Server] /api/import complete. Returning success payload.`);
      res.json(responsePayload);
    } catch (error: any) {
      console.error('[Server] Error processing import:', error);
      res.status(500).json({ error: error.message || 'Failed to process import' });
    }
  });

  app.post('/api/import/rollback', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    const { importId } = req.body;
    if (!importId) return res.status(400).json({ error: 'Missing importId' });

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const transactionsCollection = firestore.collection('transactions');
      const importsCollection = firestore.collection('imports');

      const importDoc = await importsCollection.doc(importId).get();
      const isReclassification = importDoc.exists && importDoc.data()?.reclassification === true;

      const snapshot = await transactionsCollection.where('importId', '==', importId).get();

      // If this is a normal import rollback (deletion), remove transaction IDs from recurring examples
      if (!isReclassification && snapshot.docs.length > 0) {
        const deletedTxIds = snapshot.docs.map((doc) => doc.id);
        await removeTransactionIdsFromRecurringExamples(firestore, deletedTxIds);
      }

      const batchSize = 400;
      for (let i = 0; i < snapshot.docs.length; i += batchSize) {
        const batch = firestore.batch();
        const chunk = snapshot.docs.slice(i, i + batchSize);
        chunk.forEach((doc) => {
          if (isReclassification) {
            // If it's a reclassification, revert them back to Uncategorized
            batch.update(doc.ref, {
              Category: 'Uncategorized',
              Subcategory: '',
              status: 'reviewed',
            });
          } else {
            // Normal imports are deleted
            batch.delete(doc.ref);
          }
        });
        await batch.commit();
      }

      await importsCollection.doc(importId).delete();

      res.json({
        success: true,
        deletedCount: isReclassification ? 0 : snapshot.docs.length,
        revertedCount: isReclassification ? snapshot.docs.length : 0,
      });
    } catch (err: any) {
      console.error('Rollback failed:', err);
      res.status(500).json({ error: err.message || 'Rollback failed' });
    }
  });

  app.post('/api/import/ok', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    const { importId } = req.body;
    if (!importId) return res.status(400).json({ error: 'Missing importId' });

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      await firestore.collection('imports').doc(importId).update({ archived: true });
      res.json({ success: true });
    } catch (err: any) {
      console.error('Mark OK failed:', err);
      res.status(500).json({ error: err.message || 'Failed to mark import OK' });
    }
  });

  app.get('/api/imports', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const query: any = firestore.collection('imports');
      const snapshot = await query.orderBy('date', 'desc').get();
      const imports = snapshot.docs.map((doc) => doc.data()).filter((imp) => !imp.archived);
      res.json({ imports });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get('/api/recurring', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const snapshot = await firestore.collection('recurring_transactions').get();
      const recurring = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((r: any) => !r.archived);
      res.json({ recurring });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/recurring', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const {
        frequency,
        description,
        amountAverage,
        amountMin,
        amountMax,
        exampleTransactionIds,
        matchedTransactionIds,
        projectedOccurrence,
        instancesPerPeriod,
      } = req.body;
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const docRef = await firestore.collection('recurring_transactions').add({
        frequency,
        description,
        amountAverage,
        amountMin,
        amountMax,
        exampleTransactionIds: exampleTransactionIds || [],
        matchedTransactionIds: matchedTransactionIds || [],
        projectedOccurrence: projectedOccurrence || 'Unknown',
        instancesPerPeriod: instancesPerPeriod || 1,
        archived: false,
        createdAt: new Date().toISOString(),
      });
      res.json({ success: true, id: docRef.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/recurring/:id/archive', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const { id } = req.params;
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      await firestore.collection('recurring_transactions').doc(id).update({ archived: true });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/recurring/:id', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const { id } = req.params;
      const { projectedOccurrence, description, instancesPerPeriod, exampleTransactionIds } =
        req.body;
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });

      const updateData: any = {};
      if (projectedOccurrence !== undefined) updateData.projectedOccurrence = projectedOccurrence;
      if (description !== undefined) updateData.description = description;
      if (instancesPerPeriod !== undefined) updateData.instancesPerPeriod = instancesPerPeriod;
      if (exampleTransactionIds !== undefined)
        updateData.exampleTransactionIds = exampleTransactionIds;

      if (Object.keys(updateData).length > 0) {
        await firestore.collection('recurring_transactions').doc(id).update(updateData);
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sheet', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    }

    if (!tokensCookie) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const sheetUrl = process.env.SHEET_URL || req.body.sheetUrl;
    if (!sheetUrl) {
      res.status(400).json({ error: 'Missing SHEET_URL environment variable' });
      return;
    }

    // Extract Spreadsheet ID from URL
    const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const spreadsheetId = match ? match[1] : null;

    if (!spreadsheetId) {
      res.status(400).json({ error: 'Invalid Google Sheet URL' });
      return;
    }

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const transactionsCollection = firestore.collection('transactions');
      const budgetsCollection = firestore.collection('budgets');

      const transactionsSnapshot = await transactionsCollection.get();
      const data = transactionsSnapshot.docs
        .map((doc) => {
          const raw = doc.data();
          let dateVal = raw['Date'] || raw['Posting Date'] || raw['date'] || '';
          if (dateVal && typeof dateVal.toDate === 'function') {
            dateVal = dateVal.toDate().toISOString();
          } else if (dateVal && dateVal._seconds) {
            dateVal = new Date(dateVal._seconds * 1000).toISOString();
          }
          let effectiveDateVal = raw['EffectiveDate'] || '';
          if (effectiveDateVal && typeof effectiveDateVal.toDate === 'function') {
            effectiveDateVal = effectiveDateVal.toDate().toISOString();
          } else if (effectiveDateVal && effectiveDateVal._seconds) {
            effectiveDateVal = new Date(effectiveDateVal._seconds * 1000).toISOString();
          }

          let createdAtVal = raw['createdAt'] || '';
          if (createdAtVal && typeof createdAtVal.toDate === 'function') {
            createdAtVal = createdAtVal.toDate().toISOString();
          } else if (createdAtVal && createdAtVal._seconds) {
            createdAtVal = new Date(createdAtVal._seconds * 1000).toISOString();
          }

          return {
            id: doc.id,
            Date: dateVal,
            EffectiveDate: effectiveDateVal,
            Description: raw['Description'] || raw['description'] || '',
            Amount: raw['Amount'] !== undefined ? raw['Amount'] : raw['amount'] || 0,
            Type: raw['Type'] || raw['type'] || '',
            Balance: raw['Balance'] || raw['balance'] || '',
            Category: raw['Category'] || raw['category'] || '',
            Subcategory: raw['Subcategory'] || raw['subcategory'] || '',
            status: raw['status'] || 'reviewed', // default to reviewed if missing
            importId: raw['importId'] || '',
            duplicateOfId: raw['duplicateOfId'] || undefined,
            Account: raw['Account'] || 'Checking',
            matched: raw['matched'] !== undefined ? !!raw['matched'] : false,
            createdAt: createdAtVal,
          };
        })
        .filter((tx) => tx.status !== 'archived');

      const headers = [
        'Date',
        'Description',
        'Amount',
        'Type',
        'Balance',
        'Category',
        'Subcategory',
        'status',
        'matched',
      ];

      const budgetSnapshot = await budgetsCollection.get();
      const budgetData = budgetSnapshot.docs.map((doc) => {
        const docData = doc.data();
        return {
          id: doc.id, // we can include id just in case
          '0': docData.Category,
          '1': docData.Amount,
        };
      });

      res.json({ data, headers, budgetData, budgetHeaders: [] });
    } catch (error: any) {
      console.error('Error fetching data from Firestore:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch data' });
    }
  });

  app.get('/api/migrate', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    }

    if (!tokensCookie) {
      res.status(401).json({ error: 'Not authenticated. Please log in first.' });
      return;
    }

    const sheetUrl = process.env.SHEET_URL;
    if (!sheetUrl) {
      res.status(400).json({ error: 'Missing SHEET_URL environment variable' });
      return;
    }

    const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const spreadsheetId = match ? match[1] : null;

    if (!spreadsheetId) {
      res.status(400).json({ error: 'Invalid Google Sheet URL' });
      return;
    }

    try {
      const tokens = JSON.parse(tokensCookie);
      const redirectUri = getRedirectUri(req);
      const oauth2Client = createOAuth2Client(redirectUri);
      oauth2Client.setCredentials(tokens);

      const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });

      let sheetName = '';
      const gidMatch = sheetUrl.match(/gid=([0-9]+)/);
      if (gidMatch && spreadsheet.data.sheets) {
        const gid = parseInt(gidMatch[1], 10);
        const sheet = spreadsheet.data.sheets.find((s) => s.properties?.sheetId === gid);
        if (sheet && sheet.properties?.title) {
          sheetName = sheet.properties.title;
        }
      }
      if (!sheetName && spreadsheet.data.sheets && spreadsheet.data.sheets.length > 0) {
        sheetName = spreadsheet.data.sheets[0].properties?.title || '';
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
        (s) => s.properties?.title?.toLowerCase() === 'budget'
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

      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const transactionsCollection = firestore.collection('transactions');
      const budgetsCollection = firestore.collection('budgets');

      // Write transactions
      let transactionsCount = 0;
      for (const item of data) {
        await transactionsCollection.add({
          ...item,
          createdAt: Timestamp.now(),
        });
        transactionsCount++;
      }

      // Write budgets
      let budgetsCount = 0;
      for (const item of budgetData) {
        // budgetData objects have numeric string keys like "0": category, "1": amount
        const category = item['0'];
        const amount = item['1'];
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
        message: `Successfully migrated ${transactionsCount} transactions and ${budgetsCount} budget items to Firestore.`,
      });
    } catch (error: any) {
      console.error('Error migrating to Firestore:', error);
      res.status(500).json({ error: error.message || 'Failed to migrate data' });
    }
  });

  app.post('/api/budget/update', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    }

    if (!tokensCookie) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { category, amount } = req.body;
    if (!category || amount === undefined) {
      res.status(400).json({ error: 'Missing category or amount' });
      return;
    }

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const budgetsCollection = firestore.collection('budgets');

      const querySnapshot = await budgetsCollection.where('Category', '==', category).get();

      if (querySnapshot.empty) {
        await budgetsCollection.add({ Category: category, Amount: amount });
      } else {
        const docId = querySnapshot.docs[0].id;
        await budgetsCollection.doc(docId).update({ Amount: amount });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error('Error updating budget:', error);
      res.status(500).json({ error: error.message || 'Failed to update budget' });
    }
  });

  app.post('/api/transaction/update', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    }

    if (!tokensCookie) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id, amount, category, subcategory, status, date, matched } = req.body;
    if (!id || amount === undefined || !category) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const transactionsCollection = firestore.collection('transactions');

      const parsedAmount =
        typeof amount === 'string'
          ? parseFloat(amount.replace(/[^0-9.-]+/g, ''))
          : Number(amount || 0);
      const updatesObj: Record<string, any> = {
        Amount: isNaN(parsedAmount) ? 0 : parsedAmount,
        Category: category,
      };
      if (subcategory !== undefined) {
        updatesObj.Subcategory = subcategory;
      }
      if (status !== undefined) {
        updatesObj.status = status;
      }
      if (matched !== undefined) {
        updatesObj.matched = !!matched;
      }
      if (date !== undefined) {
        const d = parseStrictDate(date);
        const newDateVal = d ? Timestamp.fromDate(d) : null;
        updatesObj.Date = newDateVal;
        updatesObj.EffectiveDate = newDateVal;
      }

      await transactionsCollection.doc(id).update(updatesObj);

      res.json({ success: true });
    } catch (error: any) {
      console.error('Error updating transaction:', error);
      res.status(500).json({ error: error.message || 'Failed to update transaction' });
    }
  });

  // Bulk update endpoint
  app.post('/api/transaction/bulk-update', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    }
    if (!tokensCookie) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { updates } = req.body;
    if (!Array.isArray(updates)) {
      res.status(400).json({ error: 'Missing updates array' });
      return;
    }

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const batchSize = 400;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = firestore.batch();
        const chunk = updates.slice(i, i + batchSize);
        chunk.forEach((update: any) => {
          const ref = firestore.collection('transactions').doc(update.id);
          const data: any = {};
          if (update.category !== undefined) data.Category = update.category;
          if (update.subcategory !== undefined) data.Subcategory = update.subcategory;
          if (update.status !== undefined) data.status = update.status;
          batch.update(ref, data);
        });
        await batch.commit();
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error in bulk update:', error);
      res.status(500).json({ error: error.message || 'Failed to bulk update' });
    }
  });

  // Taxonomy management endpoints
  app.get('/api/taxonomy', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const doc = await firestore.collection('taxonomy').doc('global').get();
      if (!doc.exists) {
        res.json({ taxonomy: {} });
      } else {
        res.json({ taxonomy: doc.data()?.mapping || {} });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/taxonomy/init', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const transactionsSnapshot = await firestore.collection('transactions').get();

      const taxonomy: Record<string, string[]> = {};

      transactionsSnapshot.docs.forEach((doc) => {
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
      Object.keys(taxonomy).forEach((cat) => {
        taxonomy[cat].sort();
      });

      await firestore.collection('taxonomy').doc('global').set({ mapping: taxonomy });
      res.json({ success: true, taxonomy });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/taxonomy/update', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const { taxonomy } = req.body;
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      await firestore.collection('taxonomy').doc('global').set({ mapping: taxonomy });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/taxonomy/check-usage', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const { category, subcategory } = req.body;
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      let query = firestore.collection('transactions').where('Category', '==', category);
      if (subcategory) {
        query = query.where('Subcategory', '==', subcategory);
      }
      const snapshot = await query.limit(1).get();
      res.json({ inUse: !snapshot.empty });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/admin/save-mapping', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const transactionsCollection = firestore.collection('transactions');
      const snapshot = await transactionsCollection.get();
      const knownMapping: Record<string, { Category: string; Subcategory: string }> = {};

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.Description && data.Category && data.Category !== 'Uncategorized') {
          knownMapping[data.Description] = {
            Category: data.Category,
            Subcategory: data.Subcategory || '',
          };
        }
      });

      const adminCollection = firestore.collection('admin');
      await adminCollection.doc('saved_mapping').set({
        mapping: knownMapping,
        transactionCount: snapshot.size,
        savedAt: FieldValue.serverTimestamp(),
      });

      res.json({ success: true, count: Object.keys(knownMapping).length });
    } catch (error: any) {
      console.error('Error saving mapping:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/admin/saved-mapping-status', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const doc = await firestore.collection('admin').doc('saved_mapping').get();

      if (!doc.exists) {
        return res.json({ exists: false });
      }

      const data = doc.data();
      res.json({
        exists: true,
        transactionCount: data?.transactionCount || 0,
        savedAt: data?.savedAt?.toDate ? data.savedAt.toDate().toISOString() : null,
      });
    } catch (error: any) {
      console.error('Error getting mapping status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/admin/reclassify', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    const { ids, importId } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0 || !importId) {
      return res.status(400).json({ error: 'Invalid payload: requires ids array and importId' });
    }

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const transactionsCollection = firestore.collection('transactions');
      const importsCollection = firestore.collection('imports');

      // 1. Fetch ALL transactions to build known mapping from categorized ones
      const snapshot = await transactionsCollection.get();
      const knownMapping: Record<string, { Category: string; Subcategory: string }> = {};
      const targetDocs: { id: string; Description: string }[] = [];
      const idsSet = new Set(ids);

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.status !== 'archived') {
          if (data.Category && data.Category !== 'Uncategorized' && data.Description) {
            knownMapping[data.Description] = {
              Category: data.Category,
              Subcategory: data.Subcategory || '',
            };
          }
          // Collect target docs from the requested IDs
          if (idsSet.has(doc.id)) {
            targetDocs.push({ id: doc.id, Description: data.Description || '' });
          }
        }
      });

      console.log(
        `[Server] Processing reclassify chunk: ${ids.length} IDs requested, ${targetDocs.length} found in DB`
      );

      if (targetDocs.length === 0) {
        return res.json({ success: true, message: 'No matching transactions found.', count: 0 });
      }

      // 2. Fetch taxonomy for strict validation
      const taxonomyDoc = await firestore.collection('taxonomy').doc('global').get();
      const globalTaxonomy = taxonomyDoc.exists ? taxonomyDoc.data()?.mapping || {} : {};

      const geminiErrorMessage = '';
      type ReclassifiedDoc = {
        id: string;
        Description: string;
        Category?: string;
        Subcategory?: string;
        status: string;
      };
      let finalTransactions: ReclassifiedDoc[] = targetDocs.map((d) => ({
        ...d,
        status: 'pending_review',
      }));

      if (process.env.GEMINI_API_KEY) {
        try {
          console.log('[Server] Calling Gemini for reclassification...');
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

          const uniqueDescs = Array.from(new Set(targetDocs.map((tx) => tx.Description))).filter(
            Boolean
          );
          console.log(`[Server] Found ${uniqueDescs.length} unique descriptions to ask Gemini`);

          if (uniqueDescs.length > 0) {
            const examplesStr = JSON.stringify(knownMapping);
            const prompt = `You are an expert financial categorizer.
Here is a JSON dictionary of my historically categorized transactions (Description -> Category/Subcategory):
${examplesStr}

Please categorize the following new transaction descriptions based on my historical patterns. Return ONLY a valid JSON object where keys are the descriptions and values are objects with "Category" and "Subcategory" strings. Make your best educated guess for new merchants.
New descriptions:
${JSON.stringify(uniqueDescs)}
`;

            const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: prompt,
            });

            const text = response.text || '';
            const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/{[\s\S]*}/);

            if (jsonMatch) {
              const parsedText = jsonMatch[1] || jsonMatch[0];
              const predictions = JSON.parse(parsedText);

              finalTransactions = targetDocs.map((tx) => {
                const pred = predictions[tx.Description];
                if (pred) {
                  let validCat = pred.Category;
                  let validSubcat = pred.Subcategory;

                  if (validCat && !globalTaxonomy[validCat]) {
                    validCat = '';
                    validSubcat = '';
                  } else if (
                    validCat &&
                    validSubcat &&
                    !globalTaxonomy[validCat].includes(validSubcat)
                  ) {
                    validSubcat = '';
                  }

                  return {
                    ...tx,
                    Category: validCat || '',
                    Subcategory: validSubcat || '',
                    status: 'pending_review',
                  };
                }
                return { ...tx, status: 'pending_review' };
              });
            }
          }
        } catch (geminiErr: any) {
          console.error('Gemini reclassification failed:', geminiErr);
          return res
            .status(500)
            .json({ error: 'Gemini AI Error: ' + (geminiErr?.message || 'Categorization failed') });
        }
      } else {
        return res.status(400).json({ error: 'No Gemini API key configured.' });
      }

      const batch = firestore.batch();

      finalTransactions.forEach((tx) => {
        const docRef = transactionsCollection.doc(tx.id);
        const updateData: any = {
          status: tx.status,
          importId: importId,
        };
        if (tx.Category && tx.Category !== 'Uncategorized') {
          updateData.Category = tx.Category;
          updateData.Subcategory = tx.Subcategory || '';
        }
        batch.update(docRef, updateData);
      });

      // Update import record atomically
      const importRef = importsCollection.doc(importId);
      batch.set(
        importRef,
        {
          importId,
          date: new Date().toISOString(),
          transactionCount: FieldValue.increment(finalTransactions.length),
          duplicateCount: 0,
          archived: false,
          reclassification: true,
        },
        { merge: true }
      );

      await batch.commit();

      res.json({
        success: true,
        message: 'Reclassification complete.',
        count: finalTransactions.length,
        geminiError: geminiErrorMessage,
      });
    } catch (error: any) {
      console.error('[Server] Reclassify Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/admin/archived-transactions', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      let query: any = firestore.collection('transactions').where('status', '==', 'archived');
      if (req.query.account && req.query.account !== 'All') {
        query = query.where('Account', '==', req.query.account as string);
      }
      const snapshot = await query.get();
      const transactions = snapshot.docs.map((doc) => {
        const raw = doc.data();
        let dateVal = raw['Date'] || raw['Posting Date'] || raw['date'] || '';
        if (dateVal && typeof dateVal.toDate === 'function') {
          dateVal = dateVal.toDate().toISOString();
        } else if (dateVal && dateVal._seconds) {
          dateVal = new Date(dateVal._seconds * 1000).toISOString();
        }
        let createdAtVal = raw['createdAt'] || '';
        if (createdAtVal && typeof createdAtVal.toDate === 'function') {
          createdAtVal = createdAtVal.toDate().toISOString();
        } else if (createdAtVal && createdAtVal._seconds) {
          createdAtVal = new Date(createdAtVal._seconds * 1000).toISOString();
        }
        return {
          id: doc.id,
          ...raw,
          Date: dateVal,
          Amount: raw['Amount'] !== undefined ? raw['Amount'] : raw['amount'] || 0,
          createdAt: createdAtVal,
        };
      });
      res.json({ transactions });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/admin/all-imports', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const query: any = firestore.collection('imports');
      const snapshot = await query.orderBy('date', 'desc').get();
      const imports = snapshot.docs.map((doc) => doc.data());
      res.json({ imports });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post('/api/admin/unarchive-import', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const { importId } = req.body;
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      await firestore.collection('imports').doc(importId).update({ archived: false });

      const txSnapshot = await firestore
        .collection('transactions')
        .where('importId', '==', importId)
        .get();
      const batch = firestore.batch();
      txSnapshot.docs.forEach((doc) => {
        batch.update(doc.ref, { status: 'reviewed' });
      });
      await batch.commit();

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/duplicate-stats', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      let query: any = firestore.collection('transactions');
      if (req.query.account && req.query.account !== 'All') {
        query = query.where('Account', '==', req.query.account as string);
      }
      const snapshot = await query.get();

      const sigMap = new Map<string, number>();
      let duplicateCount = 0;

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.status === 'archived') return;
        const sig = generateSignature(data);
        const count = sigMap.get(sig) || 0;
        if (count > 0) duplicateCount++;
        sigMap.set(sig, count + 1);
      });

      res.json({ count: duplicateCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/deduplicate', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const targetAccount = req.query.account || req.body.account;
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      let query: any = firestore.collection('transactions');
      if (targetAccount && targetAccount !== 'All') {
        query = query.where('Account', '==', targetAccount);
      }
      const snapshot = await query.get();

      const groups = new Map<string, Array<{ id: string; ref: any; data: any }>>();

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.status === 'archived') return;
        const sig = generateSignature(data);
        if (!groups.has(sig)) groups.set(sig, []);
        groups.get(sig)!.push({ id: doc.id, ref: doc.ref, data });
      });

      let deletedCount = 0;
      const batchSize = 400;
      let batch = firestore.batch();
      let opCount = 0;

      const commitBatch = async () => {
        if (opCount > 0) {
          await batch.commit();
          batch = firestore.batch();
          opCount = 0;
        }
      };

      for (const [, docs] of groups.entries()) {
        if (docs.length > 1) {
          // Sort docs to prioritize keeping the "best" one.
          // Best = Has Category (not Uncategorized), then status = reviewed, then anything else.
          docs.sort((a, b) => {
            const aCat = a.data.Category && a.data.Category !== 'Uncategorized' ? 1 : 0;
            const bCat = b.data.Category && b.data.Category !== 'Uncategorized' ? 1 : 0;
            if (aCat !== bCat) return bCat - aCat; // categorized first

            const aRev = a.data.status === 'reviewed' ? 1 : 0;
            const bRev = b.data.status === 'reviewed' ? 1 : 0;
            if (aRev !== bRev) return bRev - aRev; // reviewed first

            return 0; // tie
          });

          // Keep the first one, archive the rest
          for (let i = 1; i < docs.length; i++) {
            batch.update(docs[i].ref, { status: 'archived' });
            opCount++;
            deletedCount++;

            if (opCount >= batchSize) {
              await commitBatch();
            }
          }
        }
      }

      await commitBatch();

      res.json({ success: true, deletedCount });
    } catch (err: any) {
      console.error('Deduplication error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/scan-potential-duplicates', async (req, res) => {
    const authHeader = req.headers.authorization;
    let tokensCookie = req.cookies.google_tokens;
    if (authHeader && authHeader.startsWith('Bearer '))
      tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
    if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const targetAccount = req.query.account || req.body.account;
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      let query: any = firestore.collection('transactions');
      if (targetAccount && targetAccount !== 'All') {
        query = query.where('Account', '==', targetAccount);
      }
      const snapshot = await query.get();

      // Group by Date + Amount
      const groups = new Map<string, Array<{ id: string; ref: any; data: any }>>();

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.status === 'archived' || data.status === 'potential_duplicate') return;

        const sig = generateSignature(data);
        const parts = sig.split('|');
        if (parts.length >= 3) {
          const dateAmountKey = `${parts[0]}|${parts[2]}`;
          if (!groups.has(dateAmountKey)) groups.set(dateAmountKey, []);
          groups.get(dateAmountKey)!.push({ id: doc.id, ref: doc.ref, data });
        }
      });

      let flaggedCount = 0;
      const batchSize = 400;
      let batch = firestore.batch();
      let opCount = 0;

      const commitBatch = async () => {
        if (opCount > 0) {
          await batch.commit();
          batch = firestore.batch();
          opCount = 0;
        }
      };

      for (const [, docs] of groups.entries()) {
        if (docs.length > 1) {
          // Pick the "best" one to be the original (categorized > uncategorized)
          docs.sort((a, b) => {
            const aCat = a.data.Category && a.data.Category !== 'Uncategorized' ? 1 : 0;
            const bCat = b.data.Category && b.data.Category !== 'Uncategorized' ? 1 : 0;
            return bCat - aCat;
          });

          const original = docs[0];

          for (let i = 1; i < docs.length; i++) {
            const matchResult = areTransactionsTheSame(original.data, docs[i].data);

            if (matchResult.isMatch && matchResult.matchType === 'fuzzy') {
              batch.update(docs[i].ref, {
                status: 'potential_duplicate',
                duplicateOfId: original.id,
              });
              opCount++;
              flaggedCount++;

              if (opCount >= batchSize) {
                await commitBatch();
              }
            }
          }
        }
      }

      await commitBatch();

      res.json({ success: true, flaggedCount });
    } catch (err: any) {
      console.error('Scan potential duplicates error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/resolve-duplicate', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      let tokensCookie = req.cookies.google_tokens;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        tokensCookie = decodeURIComponent(authHeader.split(' ')[1]);
      }
      if (!tokensCookie) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const { newId, oldId, action } = req.body;
      if (!newId || !oldId || !action) {
        res.status(400).json({ error: 'Missing required parameters' });
        return;
      }

      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const txCollection = firestore.collection('transactions');

      const newTxSnap = await txCollection.doc(newId).get();
      const oldTxSnap = await txCollection.doc(oldId).get();

      if (!newTxSnap.exists) {
        res.status(404).json({ error: 'New transaction not found' });
        return;
      }

      const batch = firestore.batch();

      if (action === 'keep_original') {
        // Delete the incoming "potential_duplicate"
        batch.delete(txCollection.doc(newId));
      } else if (action === 'replace_original') {
        if (!oldTxSnap.exists) {
          res.status(404).json({ error: 'Original transaction not found' });
          return;
        }
        // Update old transaction with new description/signature, keep its category
        const newData = newTxSnap.data()!;
        const oldData = oldTxSnap.data()!;

        batch.update(txCollection.doc(oldId), {
          Description: newData.Description,
          signature: generateSignature({ ...oldData, Description: newData.Description }),
        });
        // Delete the new transaction
        batch.delete(txCollection.doc(newId));
      } else if (action === 'keep_both') {
        // Officially promote the new transaction
        batch.update(txCollection.doc(newId), {
          status: 'pending_review',
          duplicateOfId: FieldValue.delete(),
        });
      } else {
        res.status(400).json({ error: 'Invalid action' });
        return;
      }

      if (action === 'keep_original' || action === 'replace_original') {
        await removeTransactionIdsFromRecurringExamples(firestore, [newId]);
      }

      await batch.commit();
      res.json({ success: true });
    } catch (err: any) {
      console.error('Resolve duplicate error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/backfill-and-reconcile', async (req, res) => {
    try {
      const { transactions, account } = req.body;
      if (!transactions || !Array.isArray(transactions)) {
        return res.status(400).json({ error: 'Missing or invalid transactions payload' });
      }

      const firestore = new Firestore({
        projectId: 'tx-analyzer-1777844550',
        ignoreUndefinedProperties: true,
      });
      let txQuery: any = firestore.collection(process.env.FIRESTORE_COLLECTION || 'transactions');
      if (account && account !== 'All') {
        txQuery = txQuery.where('Account', '==', account);
      }
      const txCollection = firestore.collection(process.env.FIRESTORE_COLLECTION || 'transactions');

      // Step 1: Backfill imported balances
      let batch = firestore.batch();
      let opCount = 0;
      let updateCount = 0;
      const batchSize = 400;

      const commitBatch = async () => {
        if (opCount > 0) {
          await batch.commit();
          batch = firestore.batch();
          opCount = 0;
        }
      };

      // Step 1: Fetch all data ONCE to avoid multiple reads
      const allTxQuery = await txQuery.get();
      const allData = allTxQuery.docs.map((d: any) => ({
        id: d.id,
        ref: d.ref,
        data: d.data() as any,
      }));

      // Build a map of Date+Amount -> array of transactions for fast lookup
      const dbDateAmountMap = new Map<string, { ref: any; data: any }[]>();
      allData.forEach((item) => {
        const sigParts = generateSignature(item.data).split('|');
        if (sigParts.length >= 4) {
          const key = `${sigParts[0]}|${sigParts[1]}|${sigParts[3]}`;
          if (!dbDateAmountMap.has(key)) dbDateAmountMap.set(key, []);
          dbDateAmountMap.get(key)!.push(item);
        }
      });

      let currentDayStr = '';
      let intradayIndex = 0;

      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];

        // Track the current day and increment index to preserve intra-day order
        if (tx.Date !== currentDayStr) {
          currentDayStr = tx.Date;
          intradayIndex = 0;
        }
        intradayIndex++;

        if (tx.Balance !== undefined && tx.Balance !== null) {
          const sigParts = generateSignature(tx).split('|');
          if (sigParts.length >= 3) {
            const key = `${sigParts[0]}|${sigParts[2]}`;
            const candidates = dbDateAmountMap.get(key) || [];

            for (const candidate of candidates) {
              const matchResult = areTransactionsTheSame(tx, candidate.data);
              if (matchResult.isMatch) {
                const safeBalance =
                  typeof tx.Balance === 'string'
                    ? parseFloat(tx.Balance.toString().replace(/[^0-9.-]+/g, ''))
                    : Number(tx.Balance);
                const cleanBalance = isNaN(safeBalance) ? null : safeBalance;

                // Add exact intra-day timestamp offset (subtracting seconds so newest is closest to 12:00:00)
                const baseDate = parseStrictDate(tx.Date);
                let newDateVal = candidate.data.Date;
                if (baseDate) {
                  baseDate.setSeconds(baseDate.getSeconds() - intradayIndex);
                  newDateVal = Timestamp.fromDate(baseDate);
                }

                batch.update(candidate.ref, { Balance: cleanBalance, Date: newDateVal });
                candidate.data.Balance = cleanBalance; // Update in-memory so timeline sees it
                candidate.data.Date = newDateVal;
                opCount++;
                updateCount++;
              }
            }
            if (opCount >= batchSize) await commitBatch();
          }
        }
      }
      await commitBatch();

      // Step 2 & 3 & 4: Reconcile Timeline
      // Sort chronologically
      allData.sort((a, b) => {
        const dateA = a.data.Date && a.data.Date.toDate ? a.data.Date.toDate().getTime() : 0;
        const dateB = b.data.Date && b.data.Date.toDate ? b.data.Date.toDate().getTime() : 0;
        return dateA - dateB;
      });

      // Clear old discrepancies
      for (const item of allData) {
        if (item.data._category === 'Reconciliation Discrepancy') {
          batch.delete(item.ref);
          opCount++;
          if (opCount >= batchSize) await commitBatch();
        }
      }

      // Reconcile and create new ones
      let currentBalance: number | null = null;
      let discrepanciesAdded = 0;

      for (const item of allData) {
        if (item.data._category === 'Reconciliation Discrepancy') continue; // Skip those we are deleting

        if (currentBalance === null) {
          if (item.data.Balance !== undefined && item.data.Balance !== null) {
            currentBalance = Number(item.data.Balance);
          }
        } else {
          currentBalance = Number((currentBalance + Number(item.data.Amount || 0)).toFixed(2));
          if (item.data.Balance !== undefined && item.data.Balance !== null) {
            const rowBalance = Number(item.data.Balance);
            if (Math.abs(rowBalance - currentBalance) > 0.01) {
              const gap = Number((rowBalance - currentBalance).toFixed(2));

              // Create a new discrepancy transaction right before this one
              const newRef = txCollection.doc();
              batch.set(newRef, {
                Date: item.data.Date,
                Description: 'System Reconciliation Adjustment',
                Amount: gap,
                Category: 'Reconciliation Adjustment',
                _category: 'Reconciliation Discrepancy',
                Type: 'Adjustment',
                status: 'reviewed',
                importId: 'system_reconciliation',
                Account: account && account !== 'All' ? account : 'Checking',
                createdAt: Timestamp.now(),
              });
              opCount++;
              discrepanciesAdded++;

              if (opCount >= batchSize) await commitBatch();
              currentBalance = rowBalance;
            }
          }
        }
      }
      await commitBatch();

      res.json({
        success: true,
        updatedBalances: updateCount,
        discrepanciesGenerated: discrepanciesAdded,
      });
    } catch (err: any) {
      console.error('Reconciliation error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/match-transfers', async (req, res) => {
    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const transactionsCollection = firestore.collection('transactions');

      const checkingLast4 = process.env.CHECKING_ACCOUNT_NUMBER || '4765';
      const savingsLast4 = process.env.SAVINGS_ACCOUNT_NUMBER || '9301';

      // We only match active transactions
      const snapshot = await transactionsCollection.get();

      const checkingTxs: any[] = [];
      const savingsTxs: any[] = [];

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.status === 'archived') return;
        if (data.Category === 'Internal Transfer') return;
        if (data.Account === 'Checking') {
          checkingTxs.push({ id: doc.id, ref: doc.ref, ...data });
        } else if (data.Account === 'Savings') {
          savingsTxs.push({ id: doc.id, ref: doc.ref, ...data });
        }
      });

      let matchCount = 0;
      let batch = firestore.batch();
      let operationsInBatch = 0;
      const matchedIds = new Set<string>();

      for (const cTx of checkingTxs) {
        if (matchedIds.has(cTx.id)) continue;

        const cDesc = String(cTx.Description || '')
          .toLowerCase()
          .trim();
        const cIncludesSavings = cDesc.includes(savingsLast4);
        const cHasTo = /\bto\b/.test(cDesc);
        const cHasFrom = /\bfrom\b/.test(cDesc);

        if (!cIncludesSavings || (!cHasTo && !cHasFrom)) continue;

        for (const sTx of savingsTxs) {
          if (matchedIds.has(sTx.id)) continue;

          const sDesc = String(sTx.Description || '')
            .toLowerCase()
            .trim();
          const sIncludesChecking = sDesc.includes(checkingLast4);
          const sHasTo = /\bto\b/.test(sDesc);
          const sHasFrom = /\bfrom\b/.test(sDesc);

          if (!sIncludesChecking || (!sHasTo && !sHasFrom)) continue;

          const cAmt = Number(cTx.Amount);
          const sAmt = Number(sTx.Amount);

          // Absolute amounts must be equal
          if (Math.abs(cAmt) !== Math.abs(sAmt)) continue;

          // Signs must be opposite
          if (cAmt * sAmt > 0) continue;

          // Dates must match (YYYY-MM-DD)
          const cDate = cTx.Date?.toDate?.() || new Date(cTx.Date);
          const sDate = sTx.Date?.toDate?.() || new Date(sTx.Date);

          if (!cDate || !sDate || isNaN(cDate.getTime()) || isNaN(sDate.getTime())) continue;

          const cDateStr = cDate.toISOString().split('T')[0];
          const sDateStr = sDate.toISOString().split('T')[0];

          if (cDateStr === sDateStr) {
            matchedIds.add(cTx.id);
            matchedIds.add(sTx.id);

            batch.update(cTx.ref, { Category: 'Internal Transfer', linkedTransferId: sTx.id });
            batch.update(sTx.ref, { Category: 'Internal Transfer', linkedTransferId: cTx.id });

            operationsInBatch += 2;
            matchCount++;

            if (operationsInBatch >= 400) {
              await batch.commit();
              batch = firestore.batch();
              operationsInBatch = 0;
            }
            break;
          }
        }
      }

      if (operationsInBatch > 0) {
        await batch.commit();
      }

      res.json({ success: true, matchCount });
    } catch (err: any) {
      console.error('Match transfers failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/migrate-to-checking', async (req, res) => {
    try {
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const transactionsCollection = firestore.collection('transactions');

      // Note: Firestore doesn't have an 'exists' or 'is undefined' query operator.
      // Since this is a one-time migration and the dataset is likely small enough,
      // we'll fetch all transactions and update the ones missing the Account field.
      const snapshot = await transactionsCollection.get();
      let count = 0;

      const batchSize = 400;
      let batch = firestore.batch();
      let operationsInBatch = 0;

      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (!data.Account) {
          batch.update(doc.ref, { Account: 'Checking' });
          operationsInBatch++;
          count++;

          if (operationsInBatch >= batchSize) {
            await batch.commit();
            batch = firestore.batch();
            operationsInBatch = 0;
          }
        }
      }

      if (operationsInBatch > 0) {
        await batch.commit();
      }

      res.json({ success: true, updatedCount: count });
    } catch (err: any) {
      console.error('Migration failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/migrate-dates', async (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (msg: string) => {
      res.write(`${msg}\n`);
    };

    try {
      sendEvent('Starting date migration and duplicate cleanup...');
      const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
      const snapshot = await firestore.collection('transactions').get();
      const seenSignatures = new Set<string>();

      let deletedCount = 0;
      let updatedCount = 0;
      let batch = firestore.batch();
      let opsInBatch = 0;
      let totalProcessed = 0;
      const totalDocs = snapshot.docs.length;

      sendEvent(`Found ${totalDocs} transactions to process.`);

      const deletedTxIds: string[] = [];

      for (const doc of snapshot.docs) {
        const data = doc.data();

        const rawDate = data.Date || data['Posting Date'] || data.date;
        let newDateVal = rawDate !== undefined ? rawDate : null;
        const d = parseStrictDate(rawDate);
        if (d) {
          newDateVal = Timestamp.fromDate(d);
        } else if (newDateVal === undefined) {
          newDateVal = null;
        }

        // Clean up old aliases if they exist
        const updates: any = { Date: newDateVal };
        if (data['Posting Date'] !== undefined) updates['Posting Date'] = FieldValue.delete();
        if (data.date !== undefined) updates.date = FieldValue.delete();

        const newSig = generateSignature({ ...data, Date: newDateVal });
        updates.signature = newSig;

        if (seenSignatures.has(newSig)) {
          batch.delete(doc.ref);
          deletedTxIds.push(doc.id);
          deletedCount++;
          opsInBatch++;
        } else {
          seenSignatures.add(newSig);
          batch.update(doc.ref, updates);
          updatedCount++;
          opsInBatch++;
        }

        totalProcessed++;

        if (opsInBatch >= 400) {
          await batch.commit();
          batch = firestore.batch();
          opsInBatch = 0;
          sendEvent(`Processed ${totalProcessed}/${totalDocs} transactions...`);
        }
      }

      if (opsInBatch > 0) {
        await batch.commit();
      }

      if (deletedTxIds.length > 0) {
        await removeTransactionIdsFromRecurringExamples(firestore, deletedTxIds);
      }

      sendEvent(
        `Migration complete! Deleted ${deletedCount} duplicates, migrated ${updatedCount} transactions.`
      );
      res.end();
    } catch (error: any) {
      console.error('[Server] Error migrating dates:', error);
      sendEvent(`Error: ${error.message}`);
      res.end();
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  createApp()
    .then((app) => {
      const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on http://localhost:${PORT}`);
        cleanStaleRecurringExamplesOnStartup();
      });
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
    });
}
