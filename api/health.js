export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json({
    status: "ok",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
  });
}
