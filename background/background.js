/* background/background.js  v3.2 */
"use strict";

messenger.messageDisplayScripts.register({
  js:  [{ file: "content/image-detector.js" }],
  css: [{ file: "content/image-styles.css"  }]
}).catch(e => console.error("[ImgEnlarger] register failed:", e));

// ── Parse message headers from a Conversations tab URL ────────────────────────
// URL: chrome://conversations/content/stub.html?urls=imap-message%3A%2F%2F
//      Rashid%2540factsoftware.com%40imap.gmail.com%2FINBOX%2323949404,...
//
// Each imap-message URL decodes to:
//   imap-message://Rashid%40factsoftware.com@imap.gmail.com/INBOX#23949404
//
// Strategy: decode the URL, extract the account identity and folder name,
// then use messenger.messages.query() to find messages in that folder,
// matching by the message-id header embedded in the URL path.
// Simpler fallback: scan the mail tab (id:1) with getDisplayedMessages.

async function getHeadersFromConversationsUrl(tabUrl) {
  try {
    const urlObj = new URL(tabUrl);
    const urlsParam = urlObj.searchParams.get("urls");
    if (!urlsParam) return [];

    const msgUrls = urlsParam.split(",").map(u => decodeURIComponent(u.trim()));
    console.log("[ImgEnlarger] decoded msg URLs:", JSON.stringify(msgUrls));

    const headers = [];
    for (const msgUrl of msgUrls) {
      // msgUrl looks like: imap-message://user@server/FOLDER#UID
      // Extract: account user@server, folder path, UID
      const match = msgUrl.match(/^imap-message:\/\/([^/]+)\/(.+)#(\d+)$/);
      if (!match) {
        console.log("[ImgEnlarger] no match for:", msgUrl);
        continue;
      }
      const [, serverUser, folderPath, uid] = match;
      console.log("[ImgEnlarger] parsed - serverUser:", serverUser, "folder:", folderPath, "uid:", uid);

      // Find the account and folder
      const accounts = await messenger.accounts.list();
      let found = null;
      outer: for (const account of accounts) {
        for (const folder of flattenFolders(account.folders || [])) {
          // Match folder by path — folderPath may be "INBOX" or "INBOX/Subfolder"
          if (folderMatchesPath(folder, folderPath, serverUser, account)) {
            console.log("[ImgEnlarger] matched folder:", folder.name, "in account:", account.name);
            // Search messages in this folder
            found = await findMessageByUID(folder, uid);
            if (found) {
              console.log("[ImgEnlarger] found message:", found.id, found.subject);
              break outer;
            }
          }
        }
      }
      if (found) headers.push(found);
    }
    return headers;
  } catch(e) {
    console.error("[ImgEnlarger] getHeadersFromConversationsUrl error:", e);
    return [];
  }
}

function flattenFolders(folders) {
  const result = [];
  for (const f of folders) {
    result.push(f);
    if (f.subFolders) result.push(...flattenFolders(f.subFolders));
  }
  return result;
}

function folderMatchesPath(folder, folderPath, serverUser, account) {
  // Try matching by folder name (simple case: "INBOX")
  const fp = folderPath.replace(/%40/gi, "@").replace(/%20/gi, " ");
  if (folder.name.toLowerCase() === fp.toLowerCase()) return true;
  // Try matching path segments
  const parts = fp.split("/");
  if (folder.name.toLowerCase() === parts[parts.length - 1].toLowerCase()) return true;
  return false;
}

async function findMessageByUID(folder, uid) {
  // Use messages.query with the folder to get recent messages
  // then find one whose id or headerMessageId matches
  try {
    // Try querying — messages.query supports folder filter
    let page = await messenger.messages.list(folder);
    while (page) {
      for (const msg of (page.messages || [])) {
        // Thunderbird message IDs are internal DB ids, not IMAP UIDs.
        // But we can try matching the last digits
        if (String(msg.id).endsWith(uid) || uid.endsWith(String(msg.id))) {
          return msg;
        }
        // Also try: query returned messages, check if any is the right one
        // by looking at the raw uid embedded in the imap url
      }
      if (page.id) {
        page = await messenger.messages.continueList(page.id);
      } else {
        break;
      }
    }
  } catch(e) {
    console.warn("[ImgEnlarger] findMessageByUID error:", e);
  }
  return null;
}

// ── Better approach: use messages.query with no folder filter ─────────────────
// Since getDisplayedMessages works on the "mail" tab (id:1 in the log),
// try ALL tabs including inactive ones for "mail" type
async function getHeadersFromMailTab() {
  try {
    const allTabs = await messenger.tabs.query({});
    const mailTab = allTabs.find(t => t.type === "mail");
    if (!mailTab) return [];
    console.log("[ImgEnlarger] found mail tab id:", mailTab.id);
    const r = await messenger.messageDisplay.getDisplayedMessages(mailTab.id);
    const arr = Array.isArray(r) ? r : (r && r.messages) ? r.messages : [];
    console.log("[ImgEnlarger] mail tab messages:", arr.length);
    return arr;
  } catch(e) {
    console.warn("[ImgEnlarger] getHeadersFromMailTab error:", e);
    return [];
  }
}

async function getHeadersForTab(tabId, tabUrl) {
  // First try the standard API
  try {
    const r = await messenger.messageDisplay.getDisplayedMessages(tabId);
    const arr = Array.isArray(r) ? r : (r && r.messages) ? r.messages : [];
    if (arr.length) return arr;
  } catch(e) {}
  try {
    const s = await messenger.messageDisplay.getDisplayedMessage(tabId);
    if (s) return [s];
  } catch(e) {}

  // Tab is "special" (Conversations) — try the mail tab which tracks selection
  const fromMailTab = await getHeadersFromMailTab();
  if (fromMailTab.length) return fromMailTab;

  // Last resort: parse URL
  if (tabUrl && tabUrl.includes("conversations")) {
    return await getHeadersFromConversationsUrl(tabUrl);
  }

  return [];
}

// ── Trigger handlers ──────────────────────────────────────────────────────────

async function triggerFromActiveTab() {
  const tabs = await messenger.tabs.query({ active: true, currentWindow: true });
  console.log("[ImgEnlarger] trigger - active tab:", tabs[0] && tabs[0].id, tabs[0] && tabs[0].type);
  if (!tabs.length) return;
  return handleTabImages(tabs[0].id, tabs[0].url || "");
}

messenger.commands.onCommand.addListener(async (command) => {
  if (command !== "view-images") return;
  console.log("[ImgEnlarger] shortcut fired");
  return triggerFromActiveTab();
});

messenger.menus.create({
  id: "tools-view-images",
  title: "🔍 View Images in Current Message",
  contexts: ["tools_menu"]
});
messenger.menus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "tools-view-images") return;
  return triggerFromActiveTab();
});

messenger.browserAction.onClicked.addListener(() => triggerFromActiveTab());

messenger.messageDisplayAction.onClicked.addListener((tab) => {
  return handleTabImages(tab.id, tab.url || "");
});

messenger.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.action !== "imageClicked") return false;
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) return false;
  return handleImageClicked(tabId, msg.clickedIndex || 0);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// All common image extensions
const IMAGE_EXTS = /\.(png|jpe?g|jfif|gif|webp|bmp|svg|tiff?|ico|avif|heic|heif|raw|cr2|nef|orf|arw|dng|psd|eps|apng|cur|svgz)$/i;

// Map file extension to correct MIME type
const EXT_TO_MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg",
  png:  "image/png",
  gif:  "image/gif",
  webp: "image/webp",
  bmp:  "image/bmp",
  svg:  "image/svg+xml", svgz: "image/svg+xml",
  tif:  "image/tiff",    tiff: "image/tiff",
  ico:  "image/x-icon",
  avif: "image/avif",
  heic: "image/heic",    heif: "image/heif",
  apng: "image/apng",
  cur:  "image/x-win-bitmap",
  psd:  "image/vnd.adobe.photoshop",
  eps:  "image/eps",
  raw:  "image/raw",
  cr2:  "image/x-canon-cr2",
  nef:  "image/x-nikon-nef",
  orf:  "image/x-olympus-orf",
  arw:  "image/x-sony-arw",
  dng:  "image/x-adobe-dng",
};

function mimeForAttachment(file, att) {
  // 1. Use file's own type if it's a real image type
  if (file.type && file.type.startsWith("image/")) return file.type;
  // 2. Use attachment's declared content type
  if (att.contentType && att.contentType.toLowerCase().startsWith("image/")) {
    return att.contentType.toLowerCase();
  }
  // 3. Derive from file extension
  const ext = (att.name || "").split(".").pop().toLowerCase();
  if (EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  // 4. Default fallback
  return "image/png";
}

async function fetchImagesForMessage(msgId) {
  let attachments;
  try { attachments = await messenger.messages.listAttachments(msgId); }
  catch(e) { return []; }

  const candidates = attachments.filter(a => {
    const ct = (a.contentType || "").toLowerCase();
    return ct.startsWith("image/")
        || a.contentId                        // inline embedded image
        || IMAGE_EXTS.test(a.name || "")     // image-like filename
        || ct === "application/octet-stream" && IMAGE_EXTS.test(a.name || "");
  });

  const results = [];
  for (const att of candidates) {
    try {
      const file = await messenger.messages.getAttachmentFile(msgId, att.partName);
      const mime = mimeForAttachment(file, att);
      const blob = (file.type === mime) ? file : new Blob([await file.arrayBuffer()], { type: mime });
      const dataURL = await fileToDataURL(blob);
      results.push({ src: dataURL, name: att.name || "image", size: att.size || 0, mime });
    } catch(e) {
      console.warn("[ImgEnlarger] failed to fetch attachment:", att.name, e);
    }
  }
  return results;
}

async function openViewer(allImages, startIndex) {
  if (!allImages.length) { console.warn("[ImgEnlarger] no images found"); return; }
  const idx = Math.min(Math.max(startIndex, 0), allImages.length - 1);
  await messenger.storage.local.set({
    imageEnlargerSession: { images: allImages, currentIndex: idx, ts: Date.now() }
  });
  await messenger.windows.create({
    url: messenger.runtime.getURL("viewer/viewer.html"),
    type: "popup", width: 1100, height: 800
  });
}

async function handleTabImages(tabId, tabUrl) {
  const headers = await getHeadersForTab(tabId, tabUrl);
  console.log("[ImgEnlarger] handleTabImages - headers:", headers.length);
  if (!headers.length) return;
  const allImages = [];
  for (const hdr of headers) allImages.push(...await fetchImagesForMessage(hdr.id));
  await openViewer(allImages, 0);
}

async function handleImageClicked(tabId, clickedIndex) {
  const headers = await getHeadersForTab(tabId, "");
  if (!headers.length) return;
  const allImages = [];
  for (const hdr of headers) allImages.push(...await fetchImagesForMessage(hdr.id));
  await openViewer(allImages, clickedIndex);
}
