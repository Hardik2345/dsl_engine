const express = require('express');

const router = express.Router();

router.get('/link', async (req, res, next) => {
  try {
    const username = String(req.query.username || '').trim().replace(/^@/, '');
    if (!username) return res.status(400).json({ error: 'username is required' });

    const serviceUrl = process.env.TELEGRAM_SERVICE_URL;
    const secret = process.env.TELEGRAM_SERVICE_SECRET;
    if (!serviceUrl || !secret) {
      return res.status(503).json({ error: 'Telegram service integration is not configured' });
    }

    const linkUrl = new URL('/auth/telegram', `${serviceUrl.replace(/\/$/, '')}/`);
    linkUrl.searchParams.set('username', username);
    const response = await fetch(linkUrl, {
      method: 'GET',
      headers: { 'x-shared-secret': secret },
      redirect: 'manual'
    });

    const location = response.headers.get('location');
    if ((response.status < 200 || response.status >= 400) || !location) {
      const body = await response.text();
      return res.status(response.status || 502).json({
        error: body || `Telegram linking service returned ${response.status}`
      });
    }

    res.json({ username, url: location });
  } catch (error) {
    next(error);
  }
});

module.exports = router;