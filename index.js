require('dotenv').config();
const express = require('express');
const { registerRoutes } = require('./controllers');

const app = express();
app.use(express.json());

app.use('/uploads', express.static('uploads'));

registerRoutes(app);

app.listen(3000, () => console.log('Server running on http://localhost:3000'));