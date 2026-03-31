// Database and Sync Configuration
const CONFIG = {
  // Remote API endpoint (set to your server URL)
  API_URL: 'https://api.grantha.sanchaya.net',
  
  // Sync settings
  SYNC_ENABLED: true,
  SYNC_INTERVAL: 30000, // 30 seconds
  
  // SQLite database name
  DB_NAME: 'grantha.db',
  DB_VERSION: 1
};

// Database service
class DatabaseService {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
      
      request.onerror = () => reject(request.error);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Users table
        if (!db.objectStoreNames.contains('users')) {
          db.createObjectStore('users', { keyPath: 'id' });
        }
        
        // Libraries table
        if (!db.objectStoreNames.contains('libraries')) {
          const store = db.createObjectStore('libraries', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
        }
        
        // Collections table
        if (!db.objectStoreNames.contains('collections')) {
          const store = db.createObjectStore('collections', { keyPath: 'id' });
          store.createIndex('libraryId', 'libraryId', { unique: false });
        }
        
        // Books table
        if (!db.objectStoreNames.contains('books')) {
          const store = db.createObjectStore('books', { keyPath: 'id' });
          store.createIndex('collectionId', 'collectionId', { unique: false });
        }
        
        // Sync queue for offline changes
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
        }
      };
      
      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };
    });
  }

  // Generic CRUD operations
  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getById(storeName, id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName, data) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName, id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Add to sync queue
  async addToSyncQueue(action, data) {
    return this.put('syncQueue', {
      action,
      data,
      timestamp: new Date().toISOString(),
      synced: false
    });
  }

  // Get pending sync items
  async getPendingSync() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['syncQueue'], 'readonly');
      const store = transaction.objectStore('syncQueue');
      const request = store.getAll();
      request.onsuccess = () => {
        const items = request.result.filter(item => !item.synced);
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Mark sync item as synced
  async markSynced(id) {
    const item = await this.getById('syncQueue', id);
    if (item) {
      item.synced = true;
      await this.put('syncQueue', item);
    }
  }
}

// Sync service
class SyncService {
  constructor(db) {
    this.db = db;
    this.syncInterval = null;
  }

  async start() {
    if (!CONFIG.SYNC_ENABLED) return;
    
    // Initial sync
    await this.sync();
    
    // Set up periodic sync
    this.syncInterval = setInterval(() => this.sync(), CONFIG.SYNC_INTERVAL);
  }

  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
  }

  async sync() {
    try {
      // Get pending items
      const pending = await this.db.getPendingSync();
      
      for (const item of pending) {
        try {
          await this.syncItem(item);
          await this.db.markSynced(item.id);
        } catch (err) {
          console.error('Sync failed for item:', item, err);
        }
      }
      
      // Fetch updates from server
      await this.fetchRemote();
    } catch (err) {
      console.error('Sync error:', err);
    }
  }

  async syncItem(item) {
    const response = await fetch(`${CONFIG.API_URL}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(item)
    });
    
    if (!response.ok) {
      throw new Error('Sync failed');
    }
  }

  async fetchRemote() {
    // This would fetch updates from server
    // Implementation depends on your API
  }
}

// User management
class UserService {
  constructor(db) {
    this.db = db;
    this.currentUser = null;
  }

  async register(userData) {
    const user = {
      id: generateId(),
      email: userData.email,
      phone: userData.phone,
      name: userData.name,
      place: userData.place,
      city: userData.city,
      state: userData.state,
      createdAt: new Date().toISOString()
    };
    
    await this.db.put('users', user);
    this.currentUser = user;
    
    // Create default library
    await this.createLibrary(user.name + "'s Library");
    
    return user;
  }

  async login(email) {
    const users = await this.db.getAll('users');
    const user = users.find(u => u.email === email);
    if (user) {
      this.currentUser = user;
      return user;
    }
    return null;
  }

  async getCurrentUser() {
    if (this.currentUser) return this.currentUser;
    
    const users = await this.db.getAll('users');
    if (users.length > 0) {
      this.currentUser = users[0];
      return this.currentUser;
    }
    return null;
  }

  async updateProfile(userData) {
    const user = {
      ...this.currentUser,
      ...userData,
      updatedAt: new Date().toISOString()
    };
    await this.db.put('users', user);
    this.currentUser = user;
    return user;
  }

  // Library management
  async createLibrary(name, description = '') {
    const library = {
      id: generateId(),
      userId: this.currentUser.id,
      name,
      description,
      createdAt: new Date().toISOString()
    };
    await this.db.put('libraries', library);
    await this.db.addToSyncQueue('createLibrary', library);
    return library;
  }

  async updateLibrary(libraryId, data) {
    const library = await this.db.getById('libraries', libraryId);
    const updated = { ...library, ...data, updatedAt: new Date().toISOString() };
    await this.db.put('libraries', updated);
    await this.db.addToSyncQueue('updateLibrary', updated);
    return updated;
  }

  async getLibraries() {
    if (!this.currentUser) return [];
    return this.db.getByIndex('libraries', 'userId', this.currentUser.id);
  }

  // Collection management
  async createCollection(libraryId, name, description = '') {
    const collection = {
      id: generateId(),
      libraryId,
      name,
      description,
      createdAt: new Date().toISOString()
    };
    await this.db.put('collections', collection);
    await this.db.addToSyncQueue('createCollection', collection);
    return collection;
  }

  async updateCollection(collectionId, data) {
    const collection = await this.db.getById('collections', collectionId);
    const updated = { ...collection, ...data, updatedAt: new Date().toISOString() };
    await this.db.put('collections', updated);
    await this.db.addToSyncQueue('updateCollection', updated);
    return updated;
  }

  async getCollections(libraryId) {
    return this.db.getByIndex('collections', 'libraryId', libraryId);
  }

  // Book management (with collection support)
  async addBook(collectionId, bookData) {
    const book = {
      id: generateId(),
      collectionId,
      ...bookData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await this.db.put('books', book);
    await this.db.addToSyncQueue('createBook', book);
    return book;
  }

  async updateBook(bookId, data) {
    const book = await this.db.getById('books', bookId);
    const updated = { ...book, ...data, updatedAt: new Date().toISOString() };
    await this.db.put('books', updated);
    await this.db.addToSyncQueue('updateBook', updated);
    return updated;
  }

  async getBooks(collectionId) {
    return this.db.getByIndex('books', 'collectionId', collectionId);
  }

  async deleteBook(bookId) {
    await this.db.delete('books', bookId);
    await this.db.addToSyncQueue('deleteBook', { id: bookId });
  }
}
