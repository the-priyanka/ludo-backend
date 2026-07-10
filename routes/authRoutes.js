const express = require('express');
const router = express.Router();
const { register, login, updateProfile } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/register', register);
router.post('/login', login);

// Protected routes to get and update current user data
router.get('/me', protect, (req, res) => {
  res.status(200).json({ success: true, user: req.user });
});
router.put('/me', protect, updateProfile);

module.exports = router;
