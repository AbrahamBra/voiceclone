export async function extractFileText(file) {
  const name = (file.name || "").toLowerCase();

  if (
    file.type === "text/plain" ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv")
  ) {
    return await file.text();
  }

  if (name.endsWith(".pdf")) {
    const pdfjsLib = await import("pdfjs-dist");
    if (
      !pdfjsLib.GlobalWorkerOptions.workerSrc &&
      typeof window !== "undefined"
    ) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).href;
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(" "));
    }
    return pages.join("\n\n");
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const input =
      typeof Buffer !== "undefined"
        ? { buffer: Buffer.from(arrayBuffer) }
        : { arrayBuffer };
    const result = await mammoth.extractRawText(input);
    return result.value;
  }

  throw new Error(`Unsupported file format: ${name}`);
}
