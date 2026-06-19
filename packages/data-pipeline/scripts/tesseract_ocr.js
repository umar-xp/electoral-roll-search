const fs = require("fs");
const { createWorker } = require("tesseract.js");

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function normalizeLine(line) {
  return {
    text: line.text || "",
    confidence: typeof line.confidence === "number" ? line.confidence : null,
    bbox: line.bbox || null,
  };
}

async function main() {
  const raw = await readStdin();
  const payload = raw ? JSON.parse(raw) : {};

  const images = Array.isArray(payload.images) ? payload.images : [];
  const lang = typeof payload.lang === "string" && payload.lang ? payload.lang : "kan+eng";
  const psm =
    payload.psm === 0 || payload.psm ? String(payload.psm) : "3";

  if (images.length === 0) {
    process.stdout.write(JSON.stringify({ ok: true, results: [] }));
    return;
  }

  const worker = await createWorker(lang);
  await worker.setParameters({ tessedit_pageseg_mode: psm });

  const results = [];
  for (const imagePath of images) {
    const r = await worker.recognize(imagePath);
    const data = r && r.data ? r.data : {};
    const lines = Array.isArray(data.lines) ? data.lines.map(normalizeLine) : [];

    results.push({
      image: imagePath,
      confidence: typeof data.confidence === "number" ? data.confidence : null,
      text: data.text || "",
      lines,
    });
  }

  await worker.terminate();

  process.stdout.write(
    JSON.stringify({
      ok: true,
      engine: `tesseract.js@${require("tesseract.js/package.json").version}`,
      lang,
      psm,
      results,
    })
  );
}

main().catch((e) => {
  const msg = e && e.stack ? e.stack : String(e);
  try {
    process.stderr.write(msg + "\n");
  } catch {}
  process.exit(1);
});

