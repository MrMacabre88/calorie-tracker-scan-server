/**
 * Public legal pages for PortionSnap, served without the app token:
 *
 *   GET /privacy, /privacy-policy   -> privacy policy (HTML)
 *   GET /disclaimer, /terms         -> health disclaimer (HTML)
 *
 * The text lives here once and is rendered to HTML (for the server) and to Markdown
 * (for the store-listing copy, see `npm run legal:md`).
 *
 * Contact email: set PRIVACY_CONTACT_EMAIL on the server. Until then the pages show
 * the placeholder CONTACT_EMAIL_HERE.
 */

export const CONTACT_EMAIL_PLACEHOLDER = "CONTACT_EMAIL_HERE";
export const EFFECTIVE_DATE = "28 October 2026";
export const DEVELOPER_NAME = "Snappy Gecko Studios";
export const COPYRIGHT_LINE = `© 2026 ${DEVELOPER_NAME}`;
export const PUBLIC_BASE_URL = "https://calorie-tracker-scan.onrender.com";

export function contactEmail(env: Record<string, string | undefined> = process.env): string {
  const v = (env.PRIVACY_CONTACT_EMAIL ?? "").trim();
  return v || CONTACT_EMAIL_PLACEHOLDER;
}

/** Inline syntax: **bold**, [text](url), {{EMAIL}}. Blocks are paragraphs, lists or headings. */
type Block = { h2: string } | { p: string } | { ul: string[] } | { note: string };

export interface LegalDoc {
  title: string;
  subtitle: string;
  blocks: Block[];
}

const GEMINI_TERMS = "https://ai.google.dev/gemini-api/terms";
const GOOGLE_PRIVACY = "https://policies.google.com/privacy";
const OFF_PRIVACY = "https://world.openfoodfacts.org/privacy";
const RENDER_PRIVACY = "https://render.com/privacy";
const MLKIT_DISCLOSURE = "https://developers.google.com/ml-kit/android-data-disclosure";
const OAIC = "https://www.oaic.gov.au";

export const PRIVACY_POLICY: LegalDoc = {
  title: "PortionSnap Privacy Policy",
  subtitle: `Effective ${EFFECTIVE_DATE}`,
  blocks: [
    {
      p: "PortionSnap is a calorie and nutrition tracker for Android, made by Snappy Gecko Studios, the trading name of an individual developer based in Australia (\"I\", \"me\"). This policy explains in plain English what information the app handles, where it goes and why. It describes what the app and its scan server actually do.",
    },
    { h2: "The short version" },
    {
      ul: [
        "Your food log, weights, goals, recipes, fasting history and settings are stored **only on your phone**. There are no accounts and no sign-in.",
        "PortionSnap has **no advertising and no analytics or tracking tools** of its own, and I don't sell or share your information for advertising.",
        "When you use **AI photo scan**, the photo goes to my server and on to **Google's Gemini API** to estimate the nutrition. My server doesn't store it. Google may keep it, use it to improve its products, and have people review it (details below). **Only photograph food. Don't photograph people or anything personal.**",
        "**Menu & recipe scan** (PortionSnap Pro) works the same way: the menu or recipe photo goes to my server and Google's Gemini API, only when you use it, and my server doesn't store it.",
        "When you ask the **AI coach** (PortionSnap Pro) a question, the question, the last few chat messages and a short summary of today's food log and goals go to my server and Google's Gemini API to write the answer. My server doesn't store them. The chat history stays on your phone.",
        "**Health Connect** (optional, read-only): steps, exercise sessions and active calories are read and used **only on your phone**. They are never sent to my server, Google Gemini or anyone else.",
        "A **barcode scan** sends just the barcode number to **Open Food Facts**.",
        "If **Send crash reports** is on (it is by default), technical error details go to my server's logs. You can turn this off in Settings.",
        "Your **IP address** is used briefly to stop abuse of the scan service.",
      ],
    },

    { h2: "1. Who is responsible" },
    {
      p: "PortionSnap is developed and run by Snappy Gecko Studios, the trading name of an individual based in Australia. Snappy Gecko Studios isn't a registered company. You can contact me about privacy at {{EMAIL}}.",
    },

    { h2: "2. Information stored on your phone" },
    {
      p: "Everything you enter (food entries, calories and nutrients, weights, your profile and goals such as age, sex, height, activity level and goal weight, favourites, saved meals, recipes, badges, fasting history, AI coach chat history and settings) is kept in the app's private storage on your phone. I never receive it. There is no PortionSnap account or cloud sync.",
    },
    {
      p: "**Android backup:** PortionSnap allows Android's built-in backup. If backup is turned on for your Google account, Android may include the app's data in your device backup. That backup is handled by Google under your Google account, and I can't access it.",
    },

    { h2: "3. AI photo scan (food photos)" },
    {
      p: "AI photo scan is optional. When you take or choose a photo to scan, the app:",
    },
    {
      ul: [
        "compresses the photo and sends it, along with the image type and a fixed app key that identifies the app (not you), **over HTTPS to my scan server**, hosted by Render in **Singapore**;",
        "my server forwards the photo to the **Google Gemini API** with instructions to identify the food and estimate portions and nutrition, then passes the estimate back to your phone.",
      ],
    },
    {
      p: "**My server does not save your photos or the results.** They are held in memory only while the request is being handled, and they are not written to disk, a database or the logs. If Google returns an error, the server logs the error code and Google's error message, which doesn't include your photo.",
    },
    {
      p: "**Google's handling of photos.** The scan service currently uses Google's **free (unpaid) Gemini API tier**. Under [Google's Gemini API terms](" + GEMINI_TERMS + "), Google uses content sent to unpaid services, and the responses, to provide, improve and develop its products and machine-learning technology. **Human reviewers may read, annotate and process** the photos and responses. Google says it disconnects this data from the developer's account and API key before reviewers see it. Google handles this data under the [Google Privacy Policy](" + GOOGLE_PRIVACY + "). I don't control what Google keeps or for how long.",
    },
    {
      note: "Please only photograph your food. Don't include people, faces, documents, screens, addresses, cards or anything else personal or sensitive in a scan photo.",
    },
    {
      p: "**Photo details:** the app doesn't add any information to the photo. Before sending, it re-compresses the photo into a new image, which in the current version leaves out embedded photo metadata such as camera location (EXIF). Even so, avoid scanning photos you wouldn't want shared.",
    },

    { h2: "4. Menu & recipe scan (PortionSnap Pro)" },
    {
      p: "Menu & recipe scan is optional. When you photograph a restaurant menu or a recipe and tap scan, the app re-compresses the photo (leaving out embedded metadata such as location) and sends it, with the scan type you picked (menu, recipe or auto), to my scan server and on to the **Google Gemini API**, exactly as for AI photo scan above. Gemini reads the dishes or ingredients and estimates calories and nutrients per dish or per serving. **My server doesn't store the photo or the results**, and Google's handling is the same as described above. Nothing is sent unless you use this feature. Please only photograph the menu or recipe, not people or anything personal.",
    },

    { h2: "5. AI coach (PortionSnap Pro)" },
    {
      p: "The AI coach is optional. Nothing is sent until you ask it a question. When you do, the app sends over HTTPS to my server, and my server forwards to the **Google Gemini API**:",
    },
    {
      ul: [
        "your question and the last few messages of the current chat (for context);",
        "a short summary of **today only**: your calorie and macro goals, how much you've eaten and how much is left, and the names and calories/macros of the foods you logged today, plus the approximate local time and your unit choice (metric or imperial).",
      ],
    },
    {
      p: "It does **not** send your name, age, sex, height, weight, photos, earlier days, or any Health Connect data. **My server doesn't store your questions, the summary or the answers**; they are held in memory only while the request is handled and are not written to the logs. Google's handling is the same as for photos (see section 3): on the free Gemini API tier, Google may keep and use them to improve its products, and people may review them. So please don't type personal or medical details into the coach.",
    },
    {
      p: "Your chat history is saved **only on your phone** so you can scroll back. Tap **Clear** in the coach to delete it. It isn't included in backup files. The coach gives general food ideas, not medical advice.",
    },

    { h2: "6. Health Connect (PortionSnap Pro)" },
    {
      p: "If you turn on **Connect Health Connect** in Settings and grant permission, PortionSnap **reads** (never writes) these Health Connect data types: **steps**, **exercise sessions** and **active calories burned**. It reads only today's data, and uses it only to show today's steps, exercise and active calories on the Today screen and, if you turn on **Add exercise calories to my daily target** (off by default), to add today's active calories to your calorie target on that screen.",
    },
    {
      p: "Health Connect data is read and used **on your phone only**. It is **never sent to my server, Google Gemini, the AI coach or anyone else**, isn't saved by PortionSnap, isn't included in backup files, and is never sold or used for advertising. You can turn the connection off in PortionSnap's Settings, and remove PortionSnap's access at any time in the Health Connect app. The use of information received from Health Connect will adhere to the [Health Connect Permissions policy](https://support.google.com/googleplay/android-developer/answer/9888170), including the Limited Use requirements.",
    },

    { h2: "7. Barcode lookups (Open Food Facts)" },
    {
      p: "The camera reads barcodes on your phone. To look up a product, the app sends **only the barcode number** over HTTPS to [Open Food Facts](https://world.openfoodfacts.org), a non-profit food database based in France, and may load the product's picture from Open Food Facts' servers. Like any website, Open Food Facts receives your IP address and an app name (\"PortionSnap\") with these requests. See the [Open Food Facts privacy policy](" + OFF_PRIVACY + ").",
    },
    {
      p: "The barcode reader is Google's **ML Kit** library, which runs on your phone. Google says ML Kit sends Google basic diagnostics and usage information (such as phone model, Android version, app name and version, performance figures and a per-installation identifier) that isn't meant to identify you. It doesn't send the camera image or the barcode. I don't receive this data. See [Google's ML Kit data disclosure](" + MLKIT_DISCLOSURE + ").",
    },

    { h2: "8. Crash reports" },
    {
      p: "PortionSnap can send a report when something goes wrong, so I can fix bugs. This is **on by default**. You can turn it off any time in **Settings > Privacy > Send crash reports**. Turning it off also deletes any reports waiting to be sent.",
    },
    {
      p: "A crash report contains: the error message and technical stack trace, which screen you were on, the app version, Android version, phone brand and model, whether the app crashed, and the time. Reports don't include your food log, weights, profile or photos. An error message can occasionally include a short piece of text the app was handling at the time, such as a food name.",
    },
    {
      p: "Reports are sent over HTTPS and written to my server's logs **without your IP address**. If you're offline, up to 20 reports wait on your phone until they can be sent.",
    },

    { h2: "9. IP addresses and server logs" },
    {
      p: "To stop the scan service being abused, the server uses your IP address to count requests (for example, a limit on photo and menu scans per hour and per day, and on AI coach questions per day). These counters are kept **in memory only**. They reset at least daily and are cleared whenever the server restarts.",
    },
    {
      p: "When a limit is reached, the server writes a log line with the time, the IP address and which limit was hit. Server logs (including crash reports) are kept by my hosting provider, Render, for a limited time: **7 to 30 days depending on the hosting plan** (7 days on Render's Hobby plan). After that they're deleted automatically. I may copy a specific crash report while fixing a bug and delete it when I'm done. As the host, Render also handles network traffic, including IP addresses, under the [Render privacy policy](" + RENDER_PRIVACY + ").",
    },

    { h2: "10. Permissions the app asks for" },
    {
      ul: [
        "**Camera**: to take food photos for AI scan and to read barcodes. Only used when you open those screens.",
        "**Photos / storage**: to pick an existing photo to scan. On newer Android versions this uses the system photo picker, so the app only sees the photo you choose. Older Android versions may ask for storage access instead.",
        "**Health Connect** (only if you connect it): read access to steps, exercise sessions and active calories burned. Android asks you first, and you can choose which types to allow.",
        "**Notifications**: to remind you when you reach your fasting goal. These reminders are scheduled on your phone. PortionSnap doesn't use a push-notification service and has no server-sent notifications.",
        "**Other technical permissions** added by the app's libraries: internet access, checking network status, vibration, keeping scheduled reminders after a restart, and app-icon badges. A notification library also includes components for Google's push service, and another library includes Google Play's install-referrer service, but PortionSnap doesn't set up or use either.",
      ],
    },

    { h2: "11. Backups you make" },
    {
      p: "Backups are files **you** create: you choose a folder on your phone or share the file to an app you pick, such as Google Drive or email. I never receive them. Backup files contain your PortionSnap data in a readable format and **aren't encrypted**, so keep them somewhere you trust.",
    },
    {
      p: "**Sharing your progress:** the \"Share my progress\" image is created on your phone. It only goes where you choose in Android's share sheet, and nothing is sent to PortionSnap or my server.",
    },

    { h2: "12. Children" },
    {
      p: "PortionSnap is designed for adults and **isn't directed at children under 13**. The setup screens need an age of 13 or over. I don't knowingly collect personal information from children. If you're under 18, please use PortionSnap with a parent or guardian, and talk to a doctor before changing how you eat (see the [Health disclaimer](" + PUBLIC_BASE_URL + "/disclaimer)).",
    },

    { h2: "13. Keeping or deleting your information" },
    {
      ul: [
        "**On your phone:** Settings > Data > Clear all data removes your food log. The AI coach's Clear button deletes its chat history. To remove everything, clear the app's storage in Android Settings (Apps > PortionSnap > Storage > Clear storage) or uninstall the app. Uninstalling also removes any crash reports still waiting to be sent.",
        "**Crash reports and server logs:** these delete themselves when the log retention period ends. If you want a report deleted sooner, email {{EMAIL}} with the approximate date and time and your phone model. Reports aren't linked to your name, so I may not be able to find a particular one.",
        "**Google and Open Food Facts:** they hold data under their own policies, linked above. Contact them directly about it.",
      ],
    },

    { h2: "14. Security" },
    {
      p: "All network traffic from the app uses HTTPS. The scan server needs an app key and limits how often it can be used. Without accounts, there's no password or profile on my side that could leak. No system is perfectly secure, though, so please follow the advice above about what to photograph.",
    },

    { h2: "15. Sharing and overseas services" },
    {
      p: "I don't sell your information or share it for advertising. The only outside services involved are the ones described above: **Render** (hosting, Singapore), **Google** (Gemini API and ML Kit, with servers in the United States and other countries) and **Open Food Facts** (France). Using AI photo scan, menu & recipe scan, the AI coach or barcode lookup means sending that data to these overseas providers. I may also disclose information if the law requires it.",
    },

    { h2: "16. Australian privacy law" },
    {
      p: "I aim to handle personal information in line with the Australian Privacy Principles in the **Privacy Act 1988 (Cth)**. Most of your information never leaves your phone, so you can see and correct it in the app at any time. If you have a question or complaint, contact me first at {{EMAIL}} and I'll reply within 30 days. If you're not satisfied, you can contact the [Office of the Australian Information Commissioner (OAIC)](" + OAIC + ").",
    },

    { h2: "17. Changes to this policy" },
    {
      p: "If PortionSnap starts handling information differently, I'll update this page and its effective date. For significant changes, such as a new service that receives your data, I'll also mention it in the app's release notes before or when the change takes effect. Older versions are available on request.",
    },

    { h2: "18. Contact" },
    { p: "Email: {{EMAIL}}" },
  ],
};

export const HEALTH_DISCLAIMER: LegalDoc = {
  title: "PortionSnap Health Disclaimer",
  subtitle: `Effective ${EFFECTIVE_DATE}`,
  blocks: [
    { h2: "Estimates, not exact figures" },
    {
      p: "Calorie and nutrient values in PortionSnap are **estimates and may be inaccurate**. That includes AI photo scan and menu & recipe scan results (the AI can misjudge foods and portions), AI coach suggestions, barcode data from Open Food Facts (a community-edited database), food search results, and calculated targets. Always check portions and labels.",
    },
    { h2: "Not medical advice" },
    {
      p: "PortionSnap is a general tracking tool. **It isn't medical advice** and isn't intended to diagnose, treat, cure or prevent any disease or health condition. It doesn't replace a qualified health professional.",
    },
    { h2: "Talk to a professional first" },
    {
      p: "See a doctor or accredited dietitian before making major changes to your diet or starting fasting, especially if you:",
    },
    {
      ul: [
        "are pregnant or breastfeeding;",
        "are under 18;",
        "have diabetes, an eating disorder (or a history of one), or another medical condition;",
        "take medication that is affected by food or fasting.",
      ],
    },
    { h2: "Built-in safety floors" },
    {
      p: "Calculated daily calorie targets never go below a safe minimum floor (1,200 kcal for women and 1,500 kcal for men). If you set a goal by hand, only go below these levels under medical supervision.",
    },
    { h2: "Fasting" },
    {
      p: "Fasting isn't safe for everyone. Stop and seek medical help if you feel unwell, dizzy or faint. The fasting timer is a tracking tool, not a recommendation to fast.",
    },
    { h2: "If you need help" },
    {
      p: "In an emergency, call **000** in Australia (or your local emergency number). For support with eating or body image in Australia, contact the Butterfly Foundation on **1800 33 4673** ([butterfly.org.au](https://butterfly.org.au)).",
    },
    { h2: "Using PortionSnap" },
    {
      p: "You use the app's information at your own risk. Nothing in this disclaimer limits any rights you have under the Australian Consumer Law that can't be excluded. Questions: {{EMAIL}}. See also the [Privacy Policy](" + PUBLIC_BASE_URL + "/privacy).",
    },
  ],
};

// ---------- rendering ----------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function inlineHtml(text: string, email: string): string {
  let out = escapeHtml(text);
  const mail = escapeHtml(email);
  out = out.replace(/\{\{EMAIL\}\}/g, email.includes("@") ? `<a href="mailto:${mail}">${mail}</a>` : `<span class="placeholder">${mail}</span>`);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_m, label: string, url: string) => {
    const external = !url.startsWith(PUBLIC_BASE_URL);
    return `<a href="${url}"${external ? ' rel="noopener noreferrer"' : ""}>${label}</a>`;
  });
  return out;
}

function inlineMd(text: string, email: string): string {
  return text.replace(/\{\{EMAIL\}\}/g, email);
}

export function renderMarkdown(doc: LegalDoc, email = contactEmail()): string {
  const lines: string[] = [`# ${doc.title}`, "", `_${doc.subtitle}_`, ""];
  for (const b of doc.blocks) {
    if ("h2" in b) lines.push(`## ${b.h2}`, "");
    else if ("p" in b) lines.push(inlineMd(b.p, email), "");
    else if ("note" in b) lines.push(`> **${inlineMd(b.note, email)}**`, "");
    else {
      for (const item of b.ul) lines.push(`- ${inlineMd(item, email)}`);
      lines.push("");
    }
  }
  lines.push("---", "", COPYRIGHT_LINE, "");
  return lines.join("\n").trimEnd() + "\n";
}

const CSS = `
:root{--navy:#0B1630;--navy2:#13224A;--card:#111d3d;--text:#E8EEF9;--sub:#A9B6D3;--green:#39FF88;--green2:#22C55E;--line:rgba(255,255,255,.08)}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:linear-gradient(180deg,var(--navy) 0%,var(--navy2) 100%) fixed;color:var(--text);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:28px 18px 56px}
header{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.logo{width:40px;height:40px;border-radius:12px;background:var(--green);display:flex;align-items:center;justify-content:center;color:var(--navy);font-weight:900;font-size:20px;box-shadow:0 0 24px rgba(57,255,136,.35)}
.brand{font-weight:800;letter-spacing:.3px;color:var(--green)}
h1{font-size:clamp(24px,6vw,34px);line-height:1.2;margin:18px 0 4px}
.sub{color:var(--sub);margin:0 0 22px;font-size:14px}
nav{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 22px}
nav a{border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-size:14px;text-decoration:none;color:var(--text)}
nav a.on{background:var(--green);color:var(--navy);border-color:var(--green);font-weight:700}
.card{background:rgba(17,29,61,.85);border:1px solid var(--line);border-radius:18px;padding:6px 22px 18px}
h2{font-size:19px;margin:26px 0 8px;color:var(--green)}
p,li{color:var(--text)}
ul{padding-left:22px}
li{margin:6px 0}
strong{color:#fff}
a{color:var(--green)}
.note{border-left:4px solid var(--green);background:rgba(57,255,136,.08);padding:12px 16px;border-radius:10px;font-weight:700;margin:16px 0}
.placeholder{background:#FDE68A;color:#111;padding:1px 6px;border-radius:6px;font-weight:700}
footer{color:var(--sub);font-size:13px;margin-top:26px;text-align:center}
`;

export function renderHtml(doc: LegalDoc, page: "privacy" | "disclaimer", email = contactEmail()): string {
  const body = doc.blocks
    .map((b) => {
      if ("h2" in b) return `<h2>${inlineHtml(b.h2, email)}</h2>`;
      if ("p" in b) return `<p>${inlineHtml(b.p, email)}</p>`;
      if ("note" in b) return `<div class="note">${inlineHtml(b.note, email)}</div>`;
      return `<ul>${b.ul.map((i) => `<li>${inlineHtml(i, email)}</li>`).join("")}</ul>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0B1630">
<title>${escapeHtml(doc.title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header><div class="logo">P</div><div class="brand">PortionSnap</div></header>
<h1>${escapeHtml(doc.title.replace(/^PortionSnap /, ""))}</h1>
<p class="sub">${escapeHtml(doc.subtitle)}</p>
<nav><a href="/privacy"${page === "privacy" ? ' class="on"' : ""}>Privacy policy</a><a href="/disclaimer"${page === "disclaimer" ? ' class="on"' : ""}>Health disclaimer</a></nav>
<main class="card">
${body}
</main>
<footer>PortionSnap · Made in Australia<br>${escapeHtml(COPYRIGHT_LINE)}</footer>
</div>
</body>
</html>`;
}

const ROUTES: Record<string, "privacy" | "disclaimer"> = {
  "/privacy": "privacy",
  "/privacy-policy": "privacy",
  "/disclaimer": "disclaimer",
  "/terms": "disclaimer",
};

/** Returns the page for a GET/HEAD path (trailing slash allowed), or null. */
export function legalPageFor(path: string, email = contactEmail()): string | null {
  const key = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const page = ROUTES[key];
  if (!page) return null;
  return page === "privacy" ? renderHtml(PRIVACY_POLICY, "privacy", email) : renderHtml(HEALTH_DISCLAIMER, "disclaimer", email);
}
