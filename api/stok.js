module.exports = async function handler(req, res) {
  try {
    const gasUrl = process.env.GAS_WEB_APP_URL;
    if (!gasUrl) {
      res.status(500).json({
        ok: false,
        error: 'GAS_WEB_APP_URL belum diisi di Environment Variables Vercel.'
      });
      return;
    }

    const query = new URLSearchParams(req.query || {});
    const target = gasUrl + (gasUrl.includes('?') ? '&' : '?') + query.toString();

    const r = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'Accept': 'application/json,text/plain,*/*' }
    });

    const text = await r.text();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      const json = JSON.parse(text);
      res.status(r.ok ? 200 : r.status).json(json);
    } catch (parseErr) {
      res.status(502).json({
        ok: false,
        error: 'Response Apps Script bukan JSON. Cek deployment Apps Script: Execute as Me, Who has access Anyone.',
        status: r.status,
        preview: text.slice(0, 500)
      });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
};
