const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('./db');
const multer = require('multer');
const path = require('path');

// Регистрация пользователя, можно добавить куда больше полей, но у нас простенький сервис по обратной связи, перегружать его, думаю, лишнее
const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING user_id, username, email',
      [username, email, hashedPassword]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Авторизация пользователя
const login = async (req, res) => {
    const { email, password } = req.body;
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid creds' });
    }
    const accessToken = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: process.env.ACCESS_TOKEN_EXPIRES,
    });
    const refreshToken = jwt.sign(
        { user_id: user.user_id }, 
        process.env.REFRESH_TOKEN_SECRET, 
        { expiresIn: process.env.REFRESH_TOKEN_EXPIRES }
    );

    /*Включить если нужны сессии, хранение токенов и прочее. Выбран редис, поскольку в сравнении с PostgreSQL хранить в нем сессии
    и получать к ним доступ в разы быстрее, но есть минус - сервер упал - сессии пропали */
    // const sessionData = {
    //     refresh_token: refreshToken, 
    //     created_at: new Date(decodedToken.iat * 1000).toISOString(),
    //     exp_at: new Date(decodedToken.exp * 1000).toISOString(),
    //     user_id: user.id,
    //     active: true
    // };
    // await this.redis.set(
    //     `session_storage:${refreshToken}`, 
    //     JSON.stringify(sessionData)
    // );
    // await this.redis.expire(
    //     `session_storage:${refreshToken}`, 
    //     decodedToken.exp
    // );

    res.json({ accessToken,
        refreshToken });
};

// Получение данных о пользователе
const getUserById = async (req, res) => {
      const result = await query('SELECT user_id, username, email, avatar FROM users WHERE user_id = $1', [req.user_id]);
      if(result.rowCount == 0) res.status(404).json({ error: err.message = "User doesn't exist" });

      res.json(result.rows[0]);
};

const updateAvatar = (req, res) => {
  multer({
    storage: multer.diskStorage({
      destination: 'uploads/',
      filename: (req, file, cb) => {
        cb(null, `${req.user_id}-${Date.now()}${path.extname(file.originalname)}`);
      },
    }),
  }).single('avatar')(req, res, async (err) => {
    if (err) return res.status(500).json({ error: err.message });

      const avatarPath = `/uploads/${req.file.filename}`;
      await query('UPDATE users SET avatar = $1 WHERE id = $2', [avatarPath, req.user_id]);
      res.json({ message: 'Avatar uploaded successfully', avatar: avatarPath });
  });
};

// Создание предложения
const createFeedback = async (req, res) => {
  try {
    const { title, description, category, status } = req.body;
    const user_id = req.user_id;
    const result = await query(
      'INSERT INTO feedback (title, description, category, status, author_id, created_at ) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *',
      [title, description, category, status, user_id]
    );
    res.status(204);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
};

const upvoteFeedback = async (req, res) => {
    const { feedback_id, agreement} = req.body;

    await query('INSERT INTO upvotes (feedback_id, user_id, agreement) VALUES ($1, $2, $3)', [feedback_id, req.user_id, agreement]);
    res.json({ message: 'Upvote added' });
};

// Получение списка предложений с фильтрацией, сортировкой и пагинацией
const getFeedbacks = async (req, res) => {
    try {
      const { category, status, sortBy = 'created_at', order = 'desc', page = 1, limit = 10 } = req.query;
  
      let queryText = 'SELECT * FROM feedback';
      const filters = [];
      const values = [];
  
      if (category) {
        filters.push('category = $' + (values.length + 1));
        values.push(category);
      }
      if (status) {
        filters.push('status = $' + (values.length + 1));
        values.push(status);
      }
      if (filters.length > 0) {
        queryText += ' WHERE ' + filters.join(' AND ');
      }
  
      queryText += ` ORDER BY ${sortBy} ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
      values.push(limit, (page - 1) * limit);
  
      const result = await query(queryText, values);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
};

  // Получение списка категорий и статусов
const getCategoriesAndStatuses = async (req, res) => {
    const categories = await query('SELECT DISTINCT category FROM feedback');
    const statuses = await query('SELECT DISTINCT status FROM feedback');

    res.json({ categories: categories.rows, statuses: statuses.rows });
};

// Middleware для проверки токена
const authMiddleware = (req, res, next) => {
   try { 
    const payload = jwt.verify(req.headers.authorization, process.env.ACCESS_TOKEN_SECRET);
    req.user_id = payload.user_id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Маршрутизация
const registerRoutes = (app) => {
    app.post('/auth/register', register);
    app.post('/auth/login', login);
    app.get('/auth/user', authMiddleware, getUserById);
    app.patch('/auth/avatar', authMiddleware, updateAvatar);
  
    app.post('/feedback', authMiddleware, createFeedback);
    app.get('/feedback', getFeedbacks);
  
    app.post('/feedback/upvote', authMiddleware, upvoteFeedback);
  
    app.get('/metadata', getCategoriesAndStatuses);
};

module.exports = { registerRoutes };
