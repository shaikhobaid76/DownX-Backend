const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { getMediaInfo, streamMedia, proxyFile } = require('../controllers/downloadController');

const router = express.Router();

router.post('/download',
  body('url').isURL().withMessage('Valid URL is required'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }
    await getMediaInfo(req, res);
  }
);

router.get('/stream',
  query('url').isURL().withMessage('URL is required'),
  query('videoSpec').optional(),
  query('audioSpec').optional(),
  query('type').isIn(['video', 'audio']).withMessage('Type must be video or audio'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }
    await streamMedia(req, res);
  }
);

router.get('/proxy',
  query('url').isURL().withMessage('URL is required'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }
    await proxyFile(req, res);
  }
);

router.get('/test', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

module.exports = router;