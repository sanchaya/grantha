// BookScan PWA - Main Application

const LANGUAGES = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', ru: 'Russian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  ar: 'Arabic', hi: 'Hindi', th: 'Thai', vi: 'Vietnamese', nl: 'Dutch',
  pl: 'Polish', tr: 'Turkish', he: 'Hebrew', sv: 'Swedish', da: 'Danish',
  fi: 'Finnish', no: 'Norwegian', cs: 'Czech', hu: 'Hungarian', el: 'Greek',
  id: 'Indonesian', ms: 'Malay', other: 'Other'
};

const CONDITIONS = ['New', 'Like New', 'Very Good', 'Good', 'Fair', 'Poor'];

let db;
let currentTab = 'home';
let captureStep = 1;
let capturedImages = { front: null, back: null, technical: null };
let scannedIsbn = null;
let editingBook = null;
let stream = null;
let ocrResults = { front: null, back: null, technical: null };

// Run OCR on image and store result
async function runOCROnCapture(imageData, type) {
  if (!imageData) return;
  try {
    const result = await processImageWithOCR(imageData, type);
    ocrResults[type] = result;
  } catch (err) {
    console.error('OCR error on capture:', err);
  }
}

// Initialize IndexedDB
async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('BookScanDB', 1);
    
    request.onerror = () => reject(request.error);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' });
      }
    };
    
    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
  });
}

// Database operations
async function saveBook(book) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['books'], 'readwrite');
    const store = transaction.objectStore('books');
    const request = store.put(book);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getAllBooks() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['books'], 'readonly');
    const store = transaction.objectStore('books');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteBook(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['books'], 'readwrite');
    const store = transaction.objectStore('books');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Save book immediately and run OCR in background
async function saveBookImmediately() {
  const bookId = generateId();
  const book = {
    id: bookId,
    isbn: null,
    title: 'New Book',
    originalTitle: undefined,
    authors: [],
    originalAuthors: undefined,
    publisher: null,
    publishYear: null,
    pageCount: null,
    language: 'en',
    originalLanguageText: undefined,
    coverFront: capturedImages.front || undefined,
    coverBack: capturedImages.back || undefined,
    technicalPage: capturedImages.technical || undefined,
    condition: 'Good',
    notes: 'Processing OCR...',
    acquisitionDate: undefined,
    purchasePrice: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ocrStatus: 'pending'
  };
  
  await saveBook(book);
  
  // Reset for next capture
  capturedImages = { front: null, back: null, technical: null };
  ocrResults = { front: null, back: null, technical: null };
  captureStep = 1;
  
  // Show success and go to home
  showToast('Book saved! OCR running in background...');
  document.getElementById('capture-modal').classList.remove('active');
  document.querySelector('.tab[data-tab="home"]').click();
  loadBooks();
  
  // Run OCR in background and update book
  runOCRInBackground(bookId);
}

async function runOCRInBackground(bookId, externalBookData = null) {
  try {
    console.log('Starting background OCR for book:', bookId);
    const books = await getAllBooks();
    const book = books.find(b => b.id === bookId);
    if (!book) {
      console.log('Book not found');
      return;
    }
    
    // Use external book data if provided (from form), otherwise use stored data
    const bookData = externalBookData || book;
    
    let allText = '';
    let foundISBN = null;
    
    // First, try to extract ISBN from technical page with OCR
    if (bookData.technicalPage) {
      console.log('Processing technical page for ISBN...');
      const result = await processImageWithOCR(bookData.technicalPage, 'technical');
      console.log('Technical OCR result:', result);
      if (result?.text) {
        allText += '=== Technical Page ===\n' + result.text + '\n\n';
        foundISBN = extractISBN(result.text);
        console.log('ISBN from technical:', foundISBN);
      }
    }
    
    // If no ISBN from technical, try back cover
    if (!foundISBN && bookData.coverBack) {
      console.log('Processing back cover for ISBN...');
      const result = await processImageWithOCR(bookData.coverBack, 'back');
      if (result?.text) {
        allText += '=== Back Cover ===\n' + result.text + '\n\n';
        foundISBN = extractISBN(result.text);
        console.log('ISBN from back:', foundISBN);
      }
    }
    
    // Process front cover for title/author
    if (bookData.coverFront) {
      console.log('Processing front cover...');
      const result = await processImageWithOCR(bookData.coverFront, 'front');
      if (result?.text) {
        allText += '=== Front Cover ===\n' + result.text + '\n\n';
      }
    }
    
    console.log('All extracted text:', allText.substring(0, 500));
    
    // Try Open Library API first if we have ISBN
    let title = null;
    let author = null;
    let publisher = null;
    let year = null;
    let pages = null;
    
    if (foundISBN) {
      console.log('Looking up ISBN in Open Library:', foundISBN);
      try {
        const response = await fetch(
          `https://openlibrary.org/api/books?bibkeys=ISBN:${foundISBN}&format=json&jscmd=data`
        );
        const data = await response.json();
        const bookData = data[`ISBN:${foundISBN}`];
        if (bookData) {
          title = bookData.title;
          author = bookData.authors?.map(a => a.name).join(', ');
          publisher = bookData.publishers?.[0]?.name;
          year = bookData.publish_date ? parseInt(bookData.publish_date.match(/\d{4}/)?.[0]) : null;
          pages = bookData.number_of_pages;
          console.log('Open Library data:', { title, author, publisher, year, pages });
        }
      } catch (err) {
        console.error('Open Library lookup failed:', err);
      }
    }
    
    // If Open Library didn't work, try OCR extraction
    if (!title) {
      title = extractTitle(allText);
    }
    if (!author) {
      author = extractAuthor(allText);
    }
    if (!publisher) {
      publisher = extractPublisher(allText);
    }
    if (!year) {
      year = extractYear(allText);
    }
    if (!pages) {
      pages = extractPages(allText);
    }
    
    console.log('Final extracted - ISBN:', foundISBN, 'Title:', title, 'Author:', author);
    
    // Update book with extracted data
    const updatedBook = {
      ...book,
      isbn: foundISBN || null,
      title: title || book.title,
      authors: author ? author.split(',').map(a => a.trim()) : book.authors,
      publisher: publisher || null,
      publishYear: year,
      pageCount: pages,
      notes: allText.substring(0, 5000) || book.notes,
      updatedAt: new Date().toISOString(),
      ocrStatus: 'completed'
    };
    
    await saveBook(updatedBook);
    loadBooks();
    console.log('Book updated with OCR data');
    
  } catch (err) {
    console.error('Background OCR error:', err);
    // Mark as failed
    const books = await getAllBooks();
    const book = books.find(b => b.id === bookId);
    if (book) {
      book.ocrStatus = 'failed';
      book.updatedAt = new Date().toISOString();
      await saveBook(book);
      loadBooks();
    }
  }
}

// Transliteration
function detectNonLatin(text) {
  return /[^\u0000-\u007F]/.test(text);
}

function transliterate(text) {
  const cyrillic = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'sht', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo', 'Ж': 'Zh',
    'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O',
    'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'H', 'Ц': 'Ts',
    'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Sht', 'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya'
  };
  
  const greek = {
    'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'h', 'θ': 'th',
    'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p',
    'ρ': 'r', 'σ': 's', 'τ': 't', 'υ': 'u', 'φ': 'ph', 'χ': 'ch', 'ψ': 'ps', 'ω': 'o'
  };
  
  let result = '';
  for (const char of text) {
    if (cyrillic[char]) result += cyrillic[char];
    else if (greek[char]) result += greek[char];
    else result += char;
  }
  return result;
}

// Generate unique ID
function generateId() {
  return 'book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Show toast
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Tab navigation
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    currentTab = tabName;
    
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    if (tabName === 'home') {
      document.getElementById('page-title').textContent = 'My Collection';
      loadBooks();
    } else if (tabName === 'add') {
      document.getElementById('page-title').textContent = 'Add Book';
      startCapture();
    } else if (tabName === 'export') {
      document.getElementById('page-title').textContent = 'Export';
      openExportModal();
    }
  });
});

// Load books
async function loadBooks() {
  const books = await getAllBooks();
  const searchQuery = document.getElementById('search-input').value.toLowerCase();
  
  let filteredBooks = books;
  if (searchQuery) {
    filteredBooks = books.filter(book => 
      book.title.toLowerCase().includes(searchQuery) ||
      book.authors.some(a => a.toLowerCase().includes(searchQuery)) ||
      (book.isbn && book.isbn.includes(searchQuery))
    );
  }
  
  document.getElementById('total-books').textContent = books.length;
  const totalValue = books.reduce((sum, b) => sum + (b.purchasePrice || 0), 0);
  document.getElementById('total-value').textContent = '$' + totalValue.toFixed(0);
  document.getElementById('page-subtitle').textContent = `${books.length} books in your collection`;
  
  const grid = document.getElementById('book-grid');
  const emptyState = document.getElementById('empty-state');
  
  if (filteredBooks.length === 0) {
    grid.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  
  emptyState.style.display = 'none';
  grid.innerHTML = filteredBooks.map(book => `
    <div class="book-item" onclick="editBook('${book.id}')">
      <img class="book-cover" src="${book.coverFront || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 140%22><rect fill=%22%23e2e8f0%22 width=%22100%22 height=%22140%22/><text x=%2250%22 y=%2270%22 text-anchor=%22middle%22 fill=%22%2394a3b8%22 font-size=%2212%22>No Cover</text></svg>'}" alt="${book.title}">
      <div class="book-info">
        <div class="book-title">${book.title}</div>
        <div class="book-author">${book.authors.join(', ') || 'Unknown'}</div>
      </div>
    </div>
  `).join('');
}

document.getElementById('search-input').addEventListener('input', loadBooks);

// Capture functionality
let videoElement;

function startCapture() {
  captureStep = 1;
  capturedImages = { front: null, back: null, technical: null };
  ocrResults = { front: null, back: null, technical: null };
  scannedIsbn = null;
  editingBook = null;
  renderCaptureStep();
}

function renderCaptureStep() {
  const content = document.getElementById('capture-content');
  const title = document.getElementById('capture-title');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  const isMobile = isIOS || isAndroid;
  
  // Update step indicators
  document.querySelectorAll('.step-indicator .step').forEach((step, index) => {
    step.classList.remove('active', 'completed');
    if (index + 1 < captureStep) step.classList.add('completed');
    if (index + 1 === captureStep) step.classList.add('active');
  });
  
  const getStepContent = (stepName, skipTarget, optional = false) => {
    const hints = {
      front: 'Select or take a photo of the front cover',
      back: 'Select or take a photo of the back cover',
      technical: 'Select or take a photo of the copyright/ISBN page'
    };
    
    // On mobile, file input with capture will open camera directly
    // On desktop, show camera preview
    const showCamera = !isMobile;
    
    return `
      <div class="camera-container" id="camera-container" style="${showCamera ? '' : 'display:none'}">
        <video id="camera-video" autoplay playsinline webkit-playsinline></video>
        <canvas id="camera-canvas" style="display: none;"></canvas>
      </div>
      <p style="text-align: center; color: var(--text-secondary); margin: 12px 0;">
        ${hints[stepName]}
      </p>
      <button class="btn" id="select-btn-${stepName}" data-step="${stepName}">
        ${isMobile ? '📷 Take / Select Photo' : 'Select Photo'}
      </button>
      ${showCamera ? `<button class="btn btn-secondary" onclick="captureImage('${stepName}')">Use Camera</button>` : ''}
      ${optional ? `<button class="btn btn-secondary" onclick="skipCapture('${skipTarget}')">Skip</button>` : ''}
    `;
  };
  
  if (captureStep === 1) {
    title.textContent = 'Capture Front Cover';
    content.innerHTML = getStepContent('front', 'back');
    setupFileInput('front');
    if (!isMobile) startCamera();
  } else if (captureStep === 2) {
    title.textContent = 'Capture Back Cover';
    content.innerHTML = getStepContent('back', 'technical', true);
    setupFileInput('back');
    if (!isMobile) startCamera();
  } else if (captureStep === 3) {
    title.textContent = 'Capture Technical Page';
    content.innerHTML = getStepContent('technical', 'done', true);
    setupFileInput('technical');
    if (!isMobile) startCamera();
  }
  
  document.getElementById('capture-modal').classList.add('active');
}

function lookupIsbn() {
  const isbn = document.getElementById('isbn-input').value.replace(/[-\s]/g, '');
  if (isbn.length !== 10 && isbn.length !== 13) {
    showToast('Please enter a valid 10 or 13 digit ISBN');
    return;
  }
  fetchBookMetadata(isbn);
}

function setupFileInput(type) {
  // Remove old input
  const oldInput = document.getElementById('file-input-hidden');
  if (oldInput) oldInput.remove();
  
  // Create hidden file input
  const input = document.createElement('input');
  input.type = 'file';
  input.id = 'file-input-hidden';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.style.display = 'none';
  document.body.appendChild(input);
  
  // Set up button click
  const btnId = 'select-btn-' + type;
  const btn = document.getElementById(btnId);
  if (btn) {
    btn.onclick = async () => {
      input.value = '';
      input.click();
    };
  }
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const imageData = await fileToDataURL(file);
      const compressedData = await compressImageDataURL(imageData);
      capturedImages[type] = compressedData;
      
      if (type === 'front') {
        captureStep = 2;
        renderCaptureStep();
      } else if (type === 'back') {
        captureStep = 3;
        renderCaptureStep();
      } else if (type === 'technical') {
        // Save book immediately and run OCR in background
        await saveBookImmediately();
      }
    } catch (err) {
      console.error('Error processing image:', err);
    }
  };
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImageDataURL(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDimension = 1200;
      
      let width = img.width;
      let height = img.height;
      
      if (width > height && width > maxDimension) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else if (height > maxDimension) {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = dataURL;
  });
}

// Crop Modal functionality
let cropCallback = null;
let cropImage = null;
let cropType = null;
let cropRect = { x: 50, y: 50, width: 80, height: 70 }; // Percentage
let isDragging = false;
let dragHandle = null;
let dragStart = { x: 0, y: 0 };

function showCropModal(imageData, type, callback) {
  cropCallback = callback;
  cropImage = imageData;
  cropType = type;
  cropRect = { x: 10, y: 10, width: 80, height: 80 };
  
  const modal = document.getElementById('crop-modal');
  const img = document.getElementById('crop-image');
  const container = document.getElementById('crop-container');
  
  img.src = imageData;
  img.onload = () => {
    modal.classList.add('active');
    setupCropInteraction();
  };
}

function setupCropInteraction() {
  const container = document.getElementById('crop-container');
  
  const handles = ['tl', 'tr', 'bl', 'br', 'move'];
  
  handles.forEach(handle => {
    const el = document.getElementById('crop-handle-' + handle);
    if (el) {
      el.onmousedown = (e) => startDrag(e, handle);
      el.ontouchstart = (e) => startDrag(e, handle);
    }
  });
  
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('touchmove', onDrag);
  document.addEventListener('mouseup', endDrag);
  document.addEventListener('touchend', endDrag);
  
  updateCropUI();
}

function startDrag(e, handle) {
  e.preventDefault();
  isDragging = true;
  dragHandle = handle;
  const pos = getEventPos(e);
  dragStart = { x: pos.x, y: pos.y };
}

function onDrag(e) {
  if (!isDragging) return;
  e.preventDefault();
  
  const pos = getEventPos(e);
  const container = document.getElementById('crop-container');
  const rect = container.getBoundingClientRect();
  
  const dx = ((pos.x - dragStart.x) / rect.width) * 100;
  const dy = ((pos.y - dragStart.y) / rect.height) * 100;
  
  if (dragHandle === 'move') {
    cropRect.x = Math.max(0, Math.min(100 - cropRect.width, cropRect.x + dx));
    cropRect.y = Math.max(0, Math.min(100 - cropRect.height, cropRect.y + dy));
  } else if (dragHandle === 'tl') {
    const newWidth = cropRect.width - dx;
    const newHeight = cropRect.height - dy;
    if (newWidth > 10 && newHeight > 10) {
      cropRect.x += dx;
      cropRect.y += dy;
      cropRect.width = newWidth;
      cropRect.height = newHeight;
    }
  } else if (dragHandle === 'tr') {
    const newWidth = cropRect.width + dx;
    const newHeight = cropRect.height - dy;
    if (newWidth > 10 && newHeight > 10) {
      cropRect.y += dy;
      cropRect.width = newWidth;
      cropRect.height = newHeight;
    }
  } else if (dragHandle === 'bl') {
    const newWidth = cropRect.width - dx;
    const newHeight = cropRect.height + dy;
    if (newWidth > 10 && newHeight > 10) {
      cropRect.x += dx;
      cropRect.width = newWidth;
      cropRect.height = newHeight;
    }
  } else if (dragHandle === 'br') {
    const newWidth = cropRect.width + dx;
    const newHeight = cropRect.height + dy;
    if (newWidth > 10 && newHeight > 10) {
      cropRect.width = newWidth;
      cropRect.height = newHeight;
    }
  }
  
  dragStart = { x: pos.x, y: pos.y };
  updateCropUI();
}

function endDrag() {
  isDragging = false;
  dragHandle = null;
}

function getEventPos(e) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

function updateCropUI() {
  const overlay = document.getElementById('crop-overlay');
  const box = document.getElementById('crop-box');
  
  if (overlay) {
    // Create grid pattern with crop area
    overlay.style.clipPath = `polygon(
      0% 0%, 100% 0%, 100% 100%, 0% 100%,
      ${cropRect.x}% ${cropRect.y}%,
      ${cropRect.x}% ${cropRect.y + cropRect.height}%,
      ${cropRect.x + cropRect.width}% ${cropRect.y + cropRect.height}%,
      ${cropRect.x + cropRect.width}% ${cropRect.y}%
    )`;
  }
  
  if (box) {
    box.style.left = cropRect.x + '%';
    box.style.top = cropRect.y + '%';
    box.style.width = cropRect.width + '%';
    box.style.height = cropRect.height + '%';
  }
}

function applyCrop() {
  const img = document.getElementById('crop-image');
  
  // Get the displayed image dimensions
  const displayedWidth = img.clientWidth;
  const displayedHeight = img.clientHeight;
  
  // Calculate crop coordinates relative to displayed image
  const left = Math.round((cropRect.x / 100) * displayedWidth);
  const top = Math.round((cropRect.y / 100) * displayedHeight);
  const width = Math.round((cropRect.width / 100) * displayedWidth);
  const height = Math.round((cropRect.height / 100) * displayedHeight);
  
  // Scale to actual image dimensions
  const scaleX = img.naturalWidth / displayedWidth;
  const scaleY = img.naturalHeight / displayedHeight;
  
  const sourceLeft = Math.round(left * scaleX);
  const sourceTop = Math.round(top * scaleY);
  const sourceWidth = Math.round(width * scaleX);
  const sourceHeight = Math.round(height * scaleY);
  
  // Create cropped canvas
  const canvas = document.createElement('canvas');
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sourceLeft, sourceTop, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  
  const croppedData = canvas.toDataURL('image/jpeg', 0.9);
  
  // Save callback before closing modal
  const callback = cropCallback;
  closeCropModal();
  
  // Call the callback if it exists
  if (callback) {
    callback(croppedData);
  }
}

function closeCropModal() {
  document.getElementById('crop-modal').classList.remove('active');
  
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('touchmove', onDrag);
  document.removeEventListener('mouseup', endDrag);
  document.removeEventListener('touchend', endDrag);
  
  cropCallback = null;
  cropImage = null;
}

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDimension = 1200;
        
        let width = img.width;
        let height = img.height;
        
        if (width > height && width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = reject;
      img.src = event.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// OCR Functions
let tesseractWorker = null;

async function initOCR() {
  if (!tesseractWorker) {
    tesseractWorker = await Tesseract.createWorker('eng');
  }
  return tesseractWorker;
}

async function extractTextFromImage(imageData) {
  console.log('extractTextFromImage called');
  if (typeof Tesseract === 'undefined') {
    console.error('Tesseract is not loaded - library not available');
    return '';
  }
  console.log('Tesseract available, initializing worker...');
  const worker = await initOCR();
  console.log('Worker initialized, recognizing image...');
  const result = await worker.recognize(imageData);
  console.log('Recognition complete, text length:', result.data.text?.length);
  return result.data.text || '';
}

function extractISBN(text) {
  // Clean the text
  const cleanText = text.replace(/O/g, '0'); // Replace capital O with 0
  
  // Pattern for ISBN-13 (13 digits, may have dashes)
  const isbn13Pattern = /(?:ISBN(?:-?13)?:?\s*)?(?:97[89])?[-.\s]?(\d{1,5})[-.\s]?(\d{1,7})[-.\s]?(\d{1,6})[-.\s]?(\d)/g;
  
  // Pattern for ISBN-10 (10 digits, may have dashes, last can be X)
  const isbn10Pattern = /(?:ISBN(?:-?10)?:?\s*)?(\d{1,5})[-.\s]?(\d{1,7})[-.\s]?(\d{1,6})[-.\s]?([Xx0-9])/g;
  
  // Try to find ISBN-13 first
  let match;
  while ((match = isbn13Pattern.exec(cleanText)) !== null) {
    const isbn = match[0].replace(/[-\s]/g, '').replace(/ISBN:?\s*/i, '');
    if (isbn.length === 13 && /^97[89]/.test(isbn)) {
      return isbn;
    }
  }
  
  // Try ISBN-10
  isbn10Pattern.lastIndex = 0;
  while ((match = isbn10Pattern.exec(cleanText)) !== null) {
    const isbn = match[0].replace(/[-\s]/g, '').replace(/ISBN:?\s*/i, '').toUpperCase();
    if (isbn.length === 10) {
      return isbn;
    }
  }
  
  return null;
}

function extractTitle(text) {
  // Look for common title patterns
  const lines = text.split('\n').filter(line => line.trim().length > 3);
  
  // First non-empty line after any header might be title
  for (const line of lines.slice(0, 5)) {
    const cleaned = line.trim();
    // Skip lines that look like headers or numbers
    if (cleaned.length > 5 && !/^(by|page|edition|copyright|published)/i.test(cleaned)) {
      return cleaned;
    }
  }
  
  return null;
}

function extractAuthor(text) {
  const lines = text.split('\n').filter(line => line.trim().length > 3);
  
  for (const line of lines.slice(0, 10)) {
    const match = line.match(/^by\s+(.+)/i);
    if (match) {
      return match[1].trim();
    }
  }
  
  return null;
}

function extractPublisher(text) {
  const lines = text.split('\n');
  
  const publisherPatterns = [
    /publisher[:\s]+(.+)/i,
    /published[:\s]+(.+)/i,
    /imprint[:\s]+(.+)/i,
    /ISBN[:\s]*[\d-]+\s*[:\|]\s*(.+?)(?:\d{4}|$)/i
  ];
  
  for (const line of lines.slice(0, 15)) {
    for (const pattern of publisherPatterns) {
      const match = line.match(pattern);
      if (match) {
        return match[1].trim().replace(/\d{4}.*/, '').trim();
      }
    }
  }
  
  return null;
}

function extractYear(text) {
  const yearPatterns = [
    /(?:published|copyright|©)\s*[:\s]*(\d{4})/i,
    /(\d{4})\s*(?:edition|print)/i,
    /(\d{4})/
  ];
  
  for (const pattern of yearPatterns) {
    const match = text.match(pattern);
    if (match) {
      const year = parseInt(match[1]);
      if (year >= 1900 && year <= new Date().getFullYear()) {
        return year;
      }
    }
  }
  
  return null;
}

function extractPages(text) {
  const pagePatterns = [
    /(\d+)\s*pages?/i,
    /(\d+)\s*pp?\.?/i,
    /page[s]?\s*[:\s]*(\d+)/i
  ];
  
  for (const pattern of pagePatterns) {
    const match = text.match(pattern);
    if (match) {
      return parseInt(match[1]);
    }
  }
  
  return null;
}

async function processImageWithOCR(imageData, type) {
  try {
    const text = await extractTextFromImage(imageData);
    
    let result = {
      text: text,
      isbn: null,
      title: null,
      author: null,
      publisher: null,
      year: null,
      pages: null
    };
    
    if (type === 'technical') {
      result.isbn = extractISBN(text);
      result.title = extractTitle(text);
      result.author = extractAuthor(text);
      result.publisher = extractPublisher(text);
      result.year = extractYear(text);
      result.pages = extractPages(text);
    } else if (type === 'back') {
      result.isbn = extractISBN(text);
    } else if (type === 'front') {
      result.title = extractTitle(text);
      result.author = extractAuthor(text);
    }
    
    return result;
  } catch (err) {
    console.error('OCR Error:', err);
    return null;
  }
}

function setupIsbnScanner() {
  const scanBtn = document.getElementById('scan-btn');
  if (scanBtn) {
    scanBtn.onclick = () => {
      const input = document.getElementById('file-input-isbn');
      if (input) input.click();
    };
  }
  
}

async function startCamera() {
  stopCamera();
  
  const video = document.getElementById('camera-video');
  if (!video) return;
  
  // Check if we're on iOS
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  
  try {
    const constraints = {
      video: isIOS ? 
        { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } :
        { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    };
    
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    
    video.onloadedmetadata = () => {
      video.play();
    };
  } catch (err) {
    console.error('Camera error:', err);
    // Don't show toast - just let user use file picker instead
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
}

async function captureImage(type) {
  const video = document.getElementById('camera-video');
  
  if (!video || !video.srcObject || video.videoWidth === 0) {
    return;
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  
  const imageData = canvas.toDataURL('image/jpeg', 0.7);
  capturedImages[type] = imageData;
  
  stopCamera();
  
  if (type === 'front') {
    captureStep = 2;
    renderCaptureStep();
  } else if (type === 'back') {
    captureStep = 3;
    renderCaptureStep();
  } else if (type === 'technical') {
    // Save book immediately and run OCR in background
    await saveBookImmediately();
  }
}

async function skipCapture(nextStep) {
  stopCamera();
  if (nextStep === 'technical') {
    captureStep = 3;
    renderCaptureStep();
  } else if (nextStep === 'done') {
    // Skip technical page and save book immediately
    await saveBookImmediately();
  }
}

let barcodeScannerInterval;

function startBarcodeScanner() {
  const video = document.getElementById('camera-video');
  if (!video) return;
  
  // Use BarcodeDetector if available
  if ('BarcodeDetector' in window) {
    const detector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e']
    });
    
    barcodeScannerInterval = setInterval(async () => {
      try {
        const barcodes = await detector.detect(video);
        if (barcodes.length > 0) {
          const isbn = barcodes[0].rawValue.replace(/[-\s]/g, '');
          if (isbn.length === 10 || isbn.length === 13) {
            clearInterval(barcodeScannerInterval);
            stopCamera();
            fetchBookMetadata(isbn);
          }
        }
      } catch (err) {
        console.error('Barcode detection error:', err);
      }
    }, 500);
  }
}

async function fetchBookMetadata(isbn) {
  
  try {
    const response = await fetch(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
    );
    const data = await response.json();
    const bookData = data[`ISBN:${isbn}`];
    
    if (bookData) {
      scannedIsbn = isbn;
      openDetailsForm({
        isbn,
        title: bookData.title || '',
        authors: bookData.authors?.map(a => a.name) || [],
        publisher: bookData.publishers?.[0]?.name || '',
        publishYear: bookData.publish_date ? parseInt(bookData.publish_date.match(/\d{4}/)?.[0] || '0') : null,
        pageCount: bookData.number_of_pages || null,
        language: bookData.languages?.[0]?.key?.split('/').pop() || 'en'
      });
    } else {
      scannedIsbn = isbn;
      openDetailsForm({ isbn });
    }
  } catch (err) {
    console.error('ISBN lookup error:', err);
    scannedIsbn = isbn;
    openDetailsForm({ isbn });
  }
}

function closeCaptureModal() {
  stopCamera();
  if (barcodeScannerInterval) {
    clearInterval(barcodeScannerInterval);
  }
  document.getElementById('capture-modal').classList.remove('active');
  document.querySelector('.tab[data-tab="home"]').click();
}

function openDetailsForm(prefillData = {}) {
  stopCamera();
  if (barcodeScannerInterval) {
    clearInterval(barcodeScannerInterval);
  }
  
  document.getElementById('capture-modal').classList.remove('active');
  document.getElementById('details-modal').classList.add('active');
  
  // Get images from captured or from prefillData (when editing)
  const frontImage = capturedImages.front || prefillData.coverFront || '';
  const backImage = capturedImages.back || prefillData.coverBack || '';
  const techImage = capturedImages.technical || prefillData.technicalPage || '';
  
  // Set images in UI
  document.getElementById('details-images').innerHTML = `
    ${frontImage ? `<div class="image-preview"><img src="${frontImage}"><span>Front</span></div>` : ''}
    ${backImage ? `<div class="image-preview"><img src="${backImage}"><span>Back</span></div>` : ''}
    ${techImage ? `<div class="image-preview"><img src="${techImage}"><span>Technical</span></div>` : ''}
  `;
  
  document.getElementById('book-cover-front').value = frontImage;
  document.getElementById('book-cover-back').value = backImage;
  document.getElementById('book-technical-page').value = techImage;
  
  // Reset form
  document.getElementById('details-form').reset();
  document.getElementById('book-id').value = prefillData.id || generateId();
  document.getElementById('book-condition').value = 'Good';
  
  if (prefillData.id) {
    // Edit mode
    editingBook = prefillData;
    document.getElementById('save-book-btn').textContent = 'Update Book';
    document.getElementById('delete-book-btn').style.display = 'block';
    
    document.getElementById('book-title').value = prefillData.title || '';
    document.getElementById('book-original-title').value = prefillData.originalTitle || '';
    document.getElementById('book-authors').value = prefillData.authors?.join(', ') || '';
    document.getElementById('book-original-authors').value = prefillData.originalAuthors?.join(', ') || '';
    document.getElementById('book-isbn').value = prefillData.isbn || '';
    document.getElementById('book-publisher').value = prefillData.publisher || '';
    document.getElementById('book-year').value = prefillData.publishYear || '';
    document.getElementById('book-pages').value = prefillData.pageCount || '';
    document.getElementById('book-language').value = prefillData.language || 'en';
    document.getElementById('book-original-text').value = prefillData.originalLanguageText || '';
    document.getElementById('book-condition').value = prefillData.condition || 'Good';
    document.getElementById('book-notes').value = prefillData.notes || '';
    document.getElementById('book-acquisition-date').value = prefillData.acquisitionDate || '';
    document.getElementById('book-price').value = prefillData.purchasePrice || '';
    
    if (prefillData.coverFront) {
      document.getElementById('book-cover-front').value = prefillData.coverFront;
    }
    if (prefillData.coverBack) {
      document.getElementById('book-cover-back').value = prefillData.coverBack;
    }
    if (prefillData.technicalPage) {
      document.getElementById('book-technical-page').value = prefillData.technicalPage;
    }
  } else {
    // Add mode
    editingBook = null;
    document.getElementById('save-book-btn').textContent = 'Add to Collection';
    document.getElementById('delete-book-btn').style.display = 'none';
    
    if (prefillData.title) {
      document.getElementById('book-title').value = prefillData.title;
      if (detectNonLatin(prefillData.title)) {
        document.getElementById('book-original-title').value = prefillData.title;
        document.getElementById('book-title').value = transliterate(prefillData.title);
      }
    }
    
    if (prefillData.authors?.length) {
      const authorsStr = prefillData.authors.join(', ');
      document.getElementById('book-authors').value = authorsStr;
      if (detectNonLatin(authorsStr)) {
        document.getElementById('book-original-authors').value = authorsStr;
        document.getElementById('book-authors').value = transliterate(authorsStr);
      }
    }
    
    document.getElementById('book-isbn').value = prefillData.isbn || scannedIsbn || '';
    document.getElementById('book-publisher').value = prefillData.publisher || '';
    document.getElementById('book-year').value = prefillData.publishYear || '';
    document.getElementById('book-pages').value = prefillData.pageCount || '';
    document.getElementById('book-language').value = prefillData.language || 'en';
  }
  
  // Use pre-computed OCR results
  if (!prefillData.id && (capturedImages.technical || capturedImages.back || capturedImages.front)) {
    const isbnField = document.getElementById('book-isbn');
    const titleField = document.getElementById('book-title');
    const authorField = document.getElementById('book-authors');
    const publisherField = document.getElementById('book-publisher');
    const yearField = document.getElementById('book-year');
    const pagesField = document.getElementById('book-pages');
    const notesField = document.getElementById('book-notes');
    
    let allText = '';

    // Combine all OCR results
    if (ocrResults.technical?.text) allText += `--- technical ---\n${ocrResults.technical.text}\n\n`;
    if (ocrResults.back?.text) allText += `--- back ---\n${ocrResults.back.text}\n\n`;
    if (ocrResults.front?.text) allText += `--- front ---\n${ocrResults.front.text}\n\n`;

    if (allText) {
      notesField.value = allText.substring(0, 3000);
    }

    // Extract structured data from combined text
    const fullText = allText;
    const isbn = extractISBN(fullText);
    const title = extractTitle(fullText);
    const author = extractAuthor(fullText);
    const publisher = extractPublisher(fullText);
    const year = extractYear(fullText);
    const pages = extractPages(fullText);

    if (isbn) isbnField.value = isbn;
    if (title) titleField.value = title;
    if (author) authorField.value = author;
    if (publisher) publisherField.value = publisher;
    if (year) yearField.value = year;
    if (pages) pagesField.value = pages;
  }
  
  // Set condition selection
  document.querySelectorAll('#condition-options .checkbox-item').forEach(item => {
    item.classList.remove('selected');
    if (item.dataset.value === 'Good') {
      item.classList.add('selected');
    }
  });
  
  // Show/hide OCR button based on whether there are images
  const hasImages = (capturedImages.front || capturedImages.back || capturedImages.technical) ||
                    (prefillData.coverFront || prefillData.coverBack || prefillData.technicalPage);
  
  const ocrBtn = document.getElementById('ocr-btn');
  if (ocrBtn) {
    if (hasImages) {
      ocrBtn.style.display = 'block';
    } else {
      ocrBtn.style.display = 'none';
    }
  }
  
  // If this is a new book with captured images, run OCR immediately
  if (!prefillData.id && hasImages && ocrBtn) {
    setTimeout(() => {
      ocrBtn.click();
    }, 500);
  }
}

// Function to run OCR from details page button
// Function to run OCR from details page button
async function runOCRFromDetails() {
  const ocrBtn = document.getElementById('ocr-btn');
  const bookId = document.getElementById('book-id').value;
  
  if (ocrBtn) {
    ocrBtn.textContent = 'Running OCR...';
    ocrBtn.disabled = true;
  }
  
  // Get current form values to preserve them
  const currentTitle = document.getElementById('book-title').value;
  const currentAuthors = document.getElementById('book-authors').value;
  
  // Get images from form (in case they were just captured)
  const bookData = {
    technicalPage: document.getElementById('book-technical-page').value,
    coverBack: document.getElementById('book-cover-back').value,
    coverFront: document.getElementById('book-cover-front').value
  };
  
  // Run OCR with these images
  await runOCRInBackground(bookId, bookData);
  
  // Reload the book to get updated values
  const books = await getAllBooks();
  const updatedBook = books.find(b => b.id === bookId);
  if (updatedBook) {
    document.getElementById('book-title').value = updatedBook.title || currentTitle;
    document.getElementById('book-authors').value = updatedBook.authors?.join(', ') || currentAuthors;
    document.getElementById('book-isbn').value = updatedBook.isbn || '';
    document.getElementById('book-publisher').value = updatedBook.publisher || '';
    document.getElementById('book-year').value = updatedBook.publishYear || '';
    document.getElementById('book-pages').value = updatedBook.pageCount || '';
    document.getElementById('book-notes').value = updatedBook.notes || '';
  }
  
  if (ocrBtn) {
    ocrBtn.textContent = '✅ OCR Complete';
    setTimeout(() => {
      ocrBtn.textContent = '🔄 Run OCR';
      ocrBtn.disabled = false;
    }, 2000);
  }
}

document.querySelectorAll('#condition-options .checkbox-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('#condition-options .checkbox-item').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');
  });
});

document.getElementById('details-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const title = document.getElementById('book-title').value.trim();
  if (!title) {
    showToast('Please enter a title');
    return;
  }
  
  const authorsInput = document.getElementById('book-authors').value;
  const authors = authorsInput.split(',').map(a => a.trim()).filter(Boolean);
  
  const originalAuthorsInput = document.getElementById('book-original-authors').value;
  const originalAuthors = originalAuthorsInput.split(',').map(a => a.trim()).filter(Boolean);
  
  const selectedCondition = document.querySelector('#condition-options .checkbox-item.selected');
  
  const book = {
    id: document.getElementById('book-id').value,
    isbn: document.getElementById('book-isbn').value.trim() || null,
    title,
    originalTitle: document.getElementById('book-original-title').value.trim() || undefined,
    authors,
    originalAuthors: originalAuthors.length ? originalAuthors : undefined,
    publisher: document.getElementById('book-publisher').value.trim() || null,
    publishYear: parseInt(document.getElementById('book-year').value) || null,
    pageCount: parseInt(document.getElementById('book-pages').value) || null,
    language: document.getElementById('book-language').value,
    originalLanguageText: document.getElementById('book-original-text').value.trim() || undefined,
    coverFront: document.getElementById('book-cover-front').value || undefined,
    coverBack: document.getElementById('book-cover-back').value || undefined,
    technicalPage: document.getElementById('book-technical-page').value || undefined,
    condition: selectedCondition?.dataset.value || 'Good',
    notes: document.getElementById('book-notes').value.trim() || undefined,
    acquisitionDate: document.getElementById('book-acquisition-date').value || undefined,
    purchasePrice: parseFloat(document.getElementById('book-price').value) || undefined,
    createdAt: editingBook?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  await saveBook(book);
  showToast(editingBook ? 'Book updated!' : 'Book added!');
  closeDetailsModal();
  document.querySelector('.tab[data-tab="home"]').click();
});

function closeDetailsModal() {
  document.getElementById('details-modal').classList.remove('active');
  capturedImages = { front: null, back: null, technical: null };
  scannedIsbn = null;
  editingBook = null;
}

async function editBook(id) {
  const books = await getAllBooks();
  const book = books.find(b => b.id === id);
  if (book) {
    openDetailsForm(book);
  }
}

async function deleteCurrentBook() {
  if (!editingBook) return;
  
  if (confirm('Are you sure you want to delete this book?')) {
    await deleteBook(editingBook.id);
    showToast('Book deleted!');
    closeDetailsModal();
    loadBooks();
  }
}

// Export functionality
let exportFormat = 'excel';
let exportMode = 'both';

document.querySelectorAll('[data-export-format]').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('[data-export-format]').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');
    exportFormat = item.dataset.exportFormat;
  });
});

document.querySelectorAll('[data-export-mode]').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('[data-export-mode]').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');
    exportMode = item.dataset.exportMode;
  });
});

function openExportModal() {
  document.getElementById('export-modal').classList.add('active');
}

function closeExportModal() {
  document.getElementById('export-modal').classList.remove('active');
}

async function exportData() {
  const books = await getAllBooks();
  
  if (books.length === 0) {
    showToast('No books to export');
    return;
  }
  
  let dataBlob;
  let filename;
  let mimeType;
  
  if (exportFormat === 'csv') {
    const headers = ['ID', 'ISBN', 'Title', 'Original Title', 'Authors', 'Original Authors', 
                     'Publisher', 'Publish Year', 'Page Count', 'Language', 'Original Language Text',
                     'Condition', 'Notes', 'Acquisition Date', 'Purchase Price', 'Created At'];
    
    const rows = books.map(book => [
      book.id,
      book.isbn || '',
      book.title,
      book.originalTitle || '',
      book.authors.join('; '),
      book.originalAuthors?.join('; ') || '',
      book.publisher || '',
      book.publishYear || '',
      book.pageCount || '',
      book.language,
      book.originalLanguageText || '',
      book.condition,
      book.notes || '',
      book.acquisitionDate || '',
      book.purchasePrice || '',
      book.createdAt
    ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','));
    
    const csv = [headers.join(','), ...rows].join('\n');
    dataBlob = new Blob([csv], { type: 'text/csv' });
    filename = `bookscan_export_${Date.now()}.csv`;
    mimeType = 'text/csv';
  } else {
    // Excel (using a simple HTML table approach that Excel can open)
    const html = `
      <table>
        <thead>
          <tr>
            <th>ID</th><th>ISBN</th><th>Title</th><th>Original Title</th><th>Authors</th>
            <th>Publisher</th><th>Year</th><th>Pages</th><th>Language</th><th>Condition</th>
            <th>Notes</th><th>Price</th>
          </tr>
        </thead>
        <tbody>
          ${books.map(book => `
            <tr>
              <td>${book.id}</td>
              <td>${book.isbn || ''}</td>
              <td>${book.title}</td>
              <td>${book.originalTitle || ''}</td>
              <td>${book.authors.join('; ')}</td>
              <td>${book.publisher || ''}</td>
              <td>${book.publishYear || ''}</td>
              <td>${book.pageCount || ''}</td>
              <td>${book.language}</td>
              <td>${book.condition}</td>
              <td>${book.notes || ''}</td>
              <td>${book.purchasePrice || ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    dataBlob = new Blob([html], { type: 'application/vnd.ms-excel' });
    filename = `bookscan_export_${Date.now()}.xls`;
    mimeType = 'application/vnd.ms-excel';
  }
  
  // Create download link
  const url = URL.createObjectURL(dataBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast('Export downloaded!');
  closeExportModal();
}

// Header scroll handling
window.addEventListener('scroll', () => {
  const header = document.querySelector('header');
  if (window.scrollY > 50) {
    header.classList.add('compact');
  } else {
    header.classList.remove('compact');
  }
});

// Initialize app
async function init() {
  await initDB();
  loadBooks();
  
  // Pre-initialize OCR engine
  initOCR().catch(err => console.error('OCR init failed:', err));
  
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.log('SW registration failed:', err);
    });
  }
}

init();
