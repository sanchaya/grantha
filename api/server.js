require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'grantha-secret-key';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Database initialization
const db = new Database('grantha.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT,
    phone TEXT,
    place TEXT,
    city TEXT,
    state TEXT,
    createdAt TEXT,
    updatedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS libraries (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    createdAt TEXT,
    updatedAt TEXT,
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    libraryId TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    createdAt TEXT,
    updatedAt TEXT,
    FOREIGN KEY (libraryId) REFERENCES libraries(id)
  );

  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    collectionId TEXT NOT NULL,
    isbn TEXT,
    title TEXT,
    originalTitle TEXT,
    authors TEXT,
    originalAuthors TEXT,
    publisher TEXT,
    publishYear INTEGER,
    pageCount INTEGER,
    language TEXT,
    originalLanguageText TEXT,
    coverFront TEXT,
    coverBack TEXT,
    technicalPage TEXT,
    condition TEXT,
    notes TEXT,
    acquisitionDate TEXT,
    purchasePrice REAL,
    ocrStatus TEXT,
    createdAt TEXT,
    updatedAt TEXT,
    FOREIGN KEY (collectionId) REFERENCES collections(id)
  );

  CREATE INDEX IF NOT EXISTS idx_libraries_userId ON libraries(userId);
  CREATE INDEX IF NOT EXISTS idx_collections_libraryId ON collections(libraryId);
  CREATE INDEX IF NOT EXISTS idx_books_collectionId ON books(collectionId);
`);

// Auth middleware
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Helper to generate ID
const generateId = () => Math.random().toString(36).substr(2, 9) + Date.now().toString(36);

// ============ AUTH ROUTES ============

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name, phone, place, city, state } = req.body;
    
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const id = generateId();
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO users (id, email, password, name, phone, place, city, state, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, email, hashedPassword, name || '', phone || '', place || '', city || '', state || '', now, now);
    
    // Create default library
    const libraryId = generateId();
    db.prepare(`
      INSERT INTO libraries (id, userId, name, description, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(libraryId, id, name ? name + "'s Library" : 'My Library', '', now, now);
    
    // Create default collection
    const collectionId = generateId();
    db.prepare(`
      INSERT INTO collections (id, libraryId, name, description, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(collectionId, libraryId, 'Default Collection', '', now, now);
    
    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, email, name, phone, place, city, state } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ 
      token, 
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name, 
        phone: user.phone,
        place: user.place,
        city: user.city,
        state: user.state
      } 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get profile
app.get('/api/profile', auth, (req, res) => {
  const user = db.prepare('SELECT id, email, name, phone, place, city, state, createdAt FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Update profile
app.put('/api/profile', auth, (req, res) => {
  const { name, phone, place, city, state } = req.body;
  const now = new Date().toISOString();
  
  db.prepare(`
    UPDATE users SET name = ?, phone = ?, place = ?, city = ?, state = ?, updatedAt = ?
    WHERE id = ?
  `).run(name, phone, place, city, state, now, req.userId);
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json(user);
});

// ============ LIBRARY ROUTES ============

// Get libraries
app.get('/api/libraries', auth, (req, res) => {
  const libraries = db.prepare('SELECT * FROM libraries WHERE userId = ?').all(req.userId);
  res.json(libraries);
});

// Create library
app.post('/api/libraries', auth, (req, res) => {
  const { name, description } = req.body;
  const id = generateId();
  const now = new Date().toISOString();
  
  db.prepare(`
    INSERT INTO libraries (id, userId, name, description, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.userId, name, description || '', now, now);
  
  const library = db.prepare('SELECT * FROM libraries WHERE id = ?').get(id);
  res.json(library);
});

// Update library
app.put('/api/libraries/:id', auth, (req, res) => {
  const { name, description } = req.body;
  const now = new Date().toISOString();
  
  const library = db.prepare('SELECT * FROM libraries WHERE id = ? AND userId = ?').get(req.params.id, req.userId);
  if (!library) return res.status(404).json({ error: 'Library not found' });
  
  db.prepare(`
    UPDATE libraries SET name = ?, description = ?, updatedAt = ?
    WHERE id = ?
  `).run(name, description, now, req.params.id);
  
  const updated = db.prepare('SELECT * FROM libraries WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// ============ COLLECTION ROUTES ============

// Get collections
app.get('/api/collections', auth, (req, res) => {
  const { libraryId } = req.query;
  let collections;
  
  if (libraryId) {
    collections = db.prepare('SELECT * FROM collections WHERE libraryId = ?').all(libraryId);
  } else {
    const libraries = db.prepare('SELECT id FROM libraries WHERE userId = ?').all(req.userId);
    const libraryIds = libraries.map(l => l.id);
    if (libraryIds.length === 0) return res.json([]);
    
    const placeholders = libraryIds.map(() => '?').join(',');
    collections = db.prepare(`SELECT * FROM collections WHERE libraryId IN (${placeholders})`).all(...libraryIds);
  }
  
  res.json(collections);
});

// Create collection
app.post('/api/collections', auth, (req, res) => {
  const { libraryId, name, description } = req.body;
  
  const library = db.prepare('SELECT * FROM libraries WHERE id = ? AND userId = ?').get(libraryId, req.userId);
  if (!library) return res.status(404).json({ error: 'Library not found' });
  
  const id = generateId();
  const now = new Date().toISOString();
  
  db.prepare(`
    INSERT INTO collections (id, libraryId, name, description, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, libraryId, name, description || '', now, now);
  
  const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  res.json(collection);
});

// Update collection
app.put('/api/collections/:id', auth, (req, res) => {
  const { name, description } = req.body;
  const now = new Date().toISOString();
  
  const collection = db.prepare(`
    SELECT c.* FROM collections c
    JOIN libraries l ON c.libraryId = l.id
    WHERE c.id = ? AND l.userId = ?
  `).get(req.params.id, req.userId);
  
  if (!collection) return res.status(404).json({ error: 'Collection not found' });
  
  db.prepare(`
    UPDATE collections SET name = ?, description = ?, updatedAt = ?
    WHERE id = ?
  `).run(name, description, now, req.params.id);
  
  const updated = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// ============ BOOK ROUTES ============

// Get books
app.get('/api/books', auth, (req, res) => {
  const { collectionId } = req.query;
  let books;
  
  if (collectionId) {
    books = db.prepare('SELECT * FROM books WHERE collectionId = ?').all(collectionId);
  } else {
    const collections = db.prepare(`
      SELECT c.id FROM collections c
      JOIN libraries l ON c.libraryId = l.id
      WHERE l.userId = ?
    `).all(req.userId);
    
    const collectionIds = collections.map(c => c.id);
    if (collectionIds.length === 0) return res.json([]);
    
    const placeholders = collectionIds.map(() => '?').join(',');
    books = db.prepare(`SELECT * FROM books WHERE collectionId IN (${placeholders})`).all(...collectionIds);
  }
  
  // Parse authors JSON
  books = books.map(b => ({
    ...b,
    authors: b.authors ? JSON.parse(b.authors) : []
  }));
  
  res.json(books);
});

// Create book
app.post('/api/books', auth, (req, res) => {
  const {
    collectionId, isbn, title, originalTitle, authors, originalAuthors,
    publisher, publishYear, pageCount, language, originalLanguageText,
    coverFront, coverBack, technicalPage, condition, notes, acquisitionDate, purchasePrice
  } = req.body;
  
  // Verify collection belongs to user's library
  const collection = db.prepare(`
    SELECT c.* FROM collections c
    JOIN libraries l ON c.libraryId = l.id
    WHERE c.id = ? AND l.userId = ?
  `).get(collectionId, req.userId);
  
  if (!collection) return res.status(404).json({ error: 'Collection not found' });
  
  const id = generateId();
  const now = new Date().toISOString();
  
  db.prepare(`
    INSERT INTO books (
      id, collectionId, isbn, title, originalTitle, authors, originalAuthors,
      publisher, publishYear, pageCount, language, originalLanguageText,
      coverFront, coverBack, technicalPage, condition, notes, acquisitionDate, purchasePrice,
      ocrStatus, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, collectionId, isbn, title, originalTitle, JSON.stringify(authors || []), originalAuthors,
    publisher, publishYear, pageCount, language, originalLanguageText,
    coverFront, coverBack, technicalPage, condition, notes, acquisitionDate, purchasePrice,
    'pending', now, now
  );
  
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  book.authors = book.authors ? JSON.parse(book.authors) : [];
  res.json(book);
});

// Update book
app.put('/api/books/:id', auth, (req, res) => {
  const {
    isbn, title, originalTitle, authors, originalAuthors,
    publisher, publishYear, pageCount, language, originalLanguageText,
    coverFront, coverBack, technicalPage, condition, notes, acquisitionDate, purchasePrice
  } = req.body;
  const now = new Date().toISOString();
  
  const book = db.prepare(`
    SELECT b.* FROM books b
    JOIN collections c ON b.collectionId = c.id
    JOIN libraries l ON c.libraryId = l.id
    WHERE b.id = ? AND l.userId = ?
  `).get(req.params.id, req.userId);
  
  if (!book) return res.status(404).json({ error: 'Book not found' });
  
  db.prepare(`
    UPDATE books SET
      isbn = ?, title = ?, originalTitle = ?, authors = ?, originalAuthors = ?,
      publisher = ?, publishYear = ?, pageCount = ?, language = ?, originalLanguageText = ?,
      coverFront = ?, coverBack = ?, technicalPage = ?, condition = ?, notes = ?,
      acquisitionDate = ?, purchasePrice = ?, updatedAt = ?
    WHERE id = ?
  `).run(
    isbn, title, originalTitle, JSON.stringify(authors || []), originalAuthors,
    publisher, publishYear, pageCount, language, originalLanguageText,
    coverFront, coverBack, technicalPage, condition, notes, acquisitionDate, purchasePrice,
    now, req.params.id
  );
  
  const updated = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  updated.authors = updated.authors ? JSON.parse(updated.authors) : [];
  res.json(updated);
});

// Delete book
app.delete('/api/books/:id', auth, (req, res) => {
  const book = db.prepare(`
    SELECT b.* FROM books b
    JOIN collections c ON b.collectionId = c.id
    JOIN libraries l ON c.libraryId = l.id
    WHERE b.id = ? AND l.userId = ?
  `).get(req.params.id, req.userId);
  
  if (!book) return res.status(404).json({ error: 'Book not found' });
  
  db.prepare('DELETE FROM books WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============ SYNC ROUTE ============

app.post('/api/sync', auth, (req, res) => {
  const { action, data } = req.body;
  
  try {
    switch (action) {
      case 'createLibrary':
        db.prepare('INSERT OR REPLACE INTO libraries VALUES (?, ?, ?, ?, ?, ?)').run(
          data.id, data.userId, data.name, data.description, data.createdAt, data.updatedAt
        );
        break;
      case 'updateLibrary':
        db.prepare('UPDATE libraries SET name = ?, description = ?, updatedAt = ? WHERE id = ?').run(
          data.name, data.description, data.updatedAt, data.id
        );
        break;
      case 'createCollection':
        db.prepare('INSERT OR REPLACE INTO collections VALUES (?, ?, ?, ?, ?, ?)').run(
          data.id, data.libraryId, data.name, data.description, data.createdAt, data.updatedAt
        );
        break;
      case 'updateCollection':
        db.prepare('UPDATE collections SET name = ?, description = ?, updatedAt = ? WHERE id = ?').run(
          data.name, data.description, data.updatedAt, data.id
        );
        break;
      case 'createBook':
        db.prepare('INSERT OR REPLACE INTO books VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          data.id, data.collectionId, data.isbn, data.title, data.originalTitle, data.authors, data.originalAuthors,
          data.publisher, data.publishYear, data.pageCount, data.language, data.originalLanguageText,
          data.coverFront, data.coverBack, data.technicalPage, data.condition, data.notes,
          data.acquisitionDate, data.purchasePrice, data.ocrStatus, data.createdAt, data.updatedAt
        );
        break;
      case 'updateBook':
        db.prepare('UPDATE books SET isbn = ?, title = ?, authors = ?, updatedAt = ? WHERE id = ?').run(
          data.isbn, data.title, data.authors, data.updatedAt, data.id
        );
        break;
      case 'deleteBook':
        db.prepare('DELETE FROM books WHERE id = ?').run(data.id);
        break;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Grantha API running on port ${PORT}`);
});
