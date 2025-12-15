# ENR Toplists Crawler

A web scraper that automatically extracts ranking data from Engineering News-Record (ENR) toplists, including handling pagination and Cloudflare protection.

## 🎯 What Data It Collects

The crawler extracts the following information from each toplist:

- **RANK 2025** - Current year ranking
- **RANK 2024** - Previous year ranking  
- **Company Name** - Firm name (parsed from FIRM column)
- **Location** - City and state (parsed from FIRM column)

### Example Output

```json
{
  "RANK 2025": "1",
  "RANK 2024": "2",
  "Company Name": "AECOM",
  "Location": "Dallas, Texas"
}
```

## 📊 Which Toplists Are Scraped

The crawler automatically discovers and scrapes **all available toplists** from https://www.enr.com/toplists, including:

- Top 500 Design Firms
- Top 400 Contractors
- Top 600 Specialty Contractors
- Top International Design Firms
- Top International Contractors
- And many more...

For paginated lists (e.g., Top 500 with 100 entries per page), it automatically crawls all pages to collect the complete dataset.

## 📋 Prerequisites

Before running the crawler, ensure you have:

1. **Node.js** (v14 or higher)
2. **Chromium browser** installed at `/usr/bin/chromium-browser`
3. **npm packages**:
   - `puppeteer-core`

## 🚀 Installation

1. Clone or download the project files

2. Install dependencies:
```bash
npm install puppeteer-core
```

3. Verify Chromium path (update in crawler.js if different):
```bash
which chromium-browser
# Should output: /usr/bin/chromium-browser
```

## 📁 Project Structure

```
project/
├── controllers/
│   └── crawler.js          # Main crawler logic
├── index.js                # Entry point
├── enr-data/  # Output folder (created after run)
├── enr-cookies.json        # Saved cookies (created after first run)
└── chrome-profile/         # Browser profile directory (created automatically)
```

## ▶️ How to Run

### Basic Usage

```bash
node index.js
```

### What Happens When You Run It

1. **Browser Launch**: Opens Chromium in non-headless mode (you can see it working)
2. **Homepage Visit**: Navigates to enr.com
3. **Cloudflare Challenge**: If detected, pauses and waits for you to complete it manually
4. **Toplist Discovery**: Finds all available toplist links
5. **Data Extraction**: For each toplist:
   - Visits the page
   - Checks for pagination
   - Extracts data from all pages
   - Combines results
6. **Save Results**: Writes to `enr-toplists-data.json`
7. **Summary Display**: Shows crawl statistics

### Expected Runtime

- First run: 5-10 minutes (includes Cloudflare challenge)
- Subsequent runs: 3-5 minutes (cookies saved)
- Time varies based on number of toplists and pagination

## 🔐 Handling Cloudflare Challenge

When the crawler encounters Cloudflare's security check:

1. Browser window will display the challenge
2. Console shows: `🔒 Cloudflare challenge detected!`
3. **Manually complete** the verification (checkbox or puzzle)
4. Crawler automatically continues once passed
5. Cookies are saved for future runs

**Important**: Do not close the browser window during the challenge!


### File Location

The output file `/enr-data` is saved in the project root directory.


