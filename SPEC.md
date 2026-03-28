# BookScan - Book Collection Indexer

## Overview
A Progressive Web App (PWA) for indexing personal book collections. Works directly in any mobile browser - no app store installation required.

## Features

### 1. Image Capture
- Front cover capture (required)
- Back cover capture (optional)
- Technical/copyright page capture (optional)
- **Crop & Straighten**: Interactive crop tool to select book area
- Images are compressed (max 1200px, 85% JPEG quality)

### 2. ISBN Scanning
- Manual ISBN entry
- Auto-fetches metadata from Open Library API
- **OCR**: Extracts ISBN from technical page images using Tesseract.js

### 3. OCR (Optical Character Recognition)
- Uses Tesseract.js for text extraction
- Extracts text from:
  - Technical/copyright pages (ISBN, publisher info)
  - Front covers (title, author)
- Auto-detects ISBN from extracted text
- Extracted text saved to Notes for review

### 4. Metadata Management
- Title (required)
- Author(s) with comma separation
- ISBN
- Publisher, Year, Pages
- Language selection (25+ languages)
- Original title in native script
- Original language text preservation
- Condition (New, Like New, Very Good, Good, Fair, Poor)
- Notes
- Acquisition date and price

### 5. Transliteration
- Auto-detects non-Latin characters
- Converts Cyrillic, Greek, and other scripts to Latin
- Preserves original text in separate fields

### 6. Data Export
- CSV export with all metadata
- Excel export (HTML format)
- Includes all book data and fields

### 7. Local Storage
- Uses IndexedDB for offline storage
- Works without internet after first load
- Service worker for caching

## Files
- `pwa/index.html` - Main HTML file with UI
- `pwa/app.js` - Application JavaScript (all logic)
- `pwa/manifest.json` - PWA manifest
- `pwa/sw.js` - Service worker

## Usage
1. Start local server: `cd pwa && python3 -m http.server 8765`
2. Or deploy to any static hosting (GitHub Pages, Netlify, Verrcel)
3. On mobile: Open in browser → Add to Home Screen

## Workflow
1. **Add Book** → Capture photos (crop to book area)
2. **Technical Page** → OCR extracts ISBN automatically
3. **Lookup** → Auto-fetches book metadata from Open Library
4. **Review/Edit** → Fill in remaining details
5. **Save** → Book added to collection
6. **Export** → Download CSV/Excel with all data
