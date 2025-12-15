const puppeteer = require('puppeteer-core');
const fs = require('fs');

// Detects if Cloudflare security challenge is present on the page
// Waits up to 2 minutes for user to manually complete the challenge before continuing
async function waitForCloudflareChallenge(page) {
  console.log('Checking for Cloudflare challenge...');
  
  try {
    await page.waitForSelector('body', { timeout: 5000 }).catch(() => {});
    
    const isChallenge = await page.evaluate(() => {
      if (!document.body) return false;
      
      const title = document.title ? document.title.toLowerCase() : '';
      const bodyText = document.body.innerText ? document.body.innerText.toLowerCase() : '';
      
      return title.includes('just a moment') || 
             title.includes('verify') ||
             bodyText.includes('verify you are human') ||
             bodyText.includes('checking your browser') ||
             document.querySelector('#challenge-form') !== null ||
             document.querySelector('.ray_id') !== null ||
             document.querySelector('[name="cf_captcha_kind"]') !== null;
    });
    
    if (isChallenge) {
      console.log('🔒 Cloudflare challenge detected!');
      console.log('⏳ Please complete the verification in the browser window...');
      console.log('   (The script will automatically continue once verification is complete)');
      
      let attempts = 0;
      const maxAttempts = 60;
      
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const stillOnChallenge = await page.evaluate(() => {
          if (!document.body) return true;
          
          const title = document.title ? document.title.toLowerCase() : '';
          const bodyText = document.body.innerText ? document.body.innerText.toLowerCase() : '';
          
          return title.includes('just a moment') || 
                 title.includes('verify') ||
                 bodyText.includes('verify you are human') ||
                 bodyText.includes('checking your browser');
        }).catch(() => true);
        
        if (!stillOnChallenge) {
          console.log('✅ Challenge completed! Continuing...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          return true;
        }
        
        attempts++;
        if (attempts % 5 === 0) {
          console.log(`⏳ Still waiting... (${attempts * 2}s elapsed)`);
        }
      }
      
      console.log('⚠️  Timeout waiting for challenge completion');
      return false;
    }
    
    console.log('✅ No Cloudflare challenge detected');
    return true;
  } catch (error) {
    console.error('Error checking for Cloudflare challenge:', error);
    return false;
  }
}

// Searches for pagination table on the page and extracts all pagination links
// Returns array of links to additional pages (e.g., 101-200, 201-300, etc.)
async function getPaginationLinks(page) {
  console.log('  🔍 Checking for pagination...');
  
  const paginationLinks = await page.evaluate(() => {
    const paginationTable = document.querySelector('table#paginationTable');
    
    if (!paginationTable) {
      return [];
    }
    
    const links = [];
    const anchors = paginationTable.querySelectorAll('a[href]');
    
    anchors.forEach(a => {
      if (a.href && a.href.includes('toplists')) {
        links.push({
          href: a.href,
          text: a.textContent.trim()
        });
      }
    });
    
    return links;
  });
  
  if (paginationLinks.length > 0) {
    console.log(`  ✅ Found ${paginationLinks.length} pagination pages`);
  } else {
    console.log('  ℹ️  No pagination found');
  }
  
  return paginationLinks;
}

// Extracts ranking data from all tables on the page, parsing company names and locations from FIRM column
// Returns structured data with only RANK 2025, RANK 2024, Company Name, and Location fields
async function extractTableData(page, url) {
  console.log(`    📊 Extracting table data...`);
  
  try {
    // Wait for any table to be present
    await page.waitForSelector('table', { timeout: 10000 }).catch(() => {
      console.log('    ⚠️  No tables found on this page');
      return null;
    });
    
    // Extract data from ALL tables on the page
    const allTablesData = await page.evaluate(() => {
      // Get all tables on the page, but skip pagination table
      const tables = Array.from(document.querySelectorAll('table')).filter(
        table => table.id !== 'paginationTable'
      );
      
      const tablesResults = [];
      
      tables.forEach((table, tableIndex) => {
        const rows = [];
        const headers = [];
        
        // Get headers with better extraction
        const headerCells = table.querySelectorAll('thead th');
        headerCells.forEach(th => {
          let headerText = th.textContent.trim();
          
          // Try to get from data-label attribute if text is malformed
          const dataLabel = th.getAttribute('data-label');
          if (dataLabel && dataLabel.trim()) {
            headerText = dataLabel.trim();
          }
          
          headers.push(headerText);
        });
        
        // Skip if no headers found
        if (headers.length === 0) {
          return;
        }
        
        // Find the indices of the columns we need with very flexible matching
        let rank2025Index = -1;
        let rank2024Index = -1;
        let firmIndex = -1;
        
        headers.forEach((h, idx) => {
          const normalized = h.toUpperCase().replace(/\s+/g, '');
          
          // Match any variation of RANK 2025
          // Handles: "RANK 2025", "Rank 2025", "RANK RANK 2025", "RANK2025"
          if (normalized.includes('2025') && normalized.includes('RANK')) {
            rank2025Index = idx;
          }
          // Match any variation of RANK 2024/2023
          // Handles: "RANK 2024", "Rank 2024", "RANK RANK 2024", "RANK2024", "RANK 2023"
          else if ((normalized.includes('2024') || normalized.includes('2023')) && 
                   normalized.includes('RANK')) {
            if (rank2024Index === -1) { // Take first match only
              rank2024Index = idx;
            }
          }
          // Match any variation of FIRM
          // Handles: "FIRM", "Firm", "FIRMS", "Firms"
           if (normalized === 'FIRM' || normalized === 'FIRMS') {
            firmIndex = idx;
          }
        });
        
        // Skip table if it doesn't have the required columns
        if (firmIndex === -1) {
          return;
        }
        
        // Get data rows
        const dataRows = table.querySelectorAll('tbody tr');
        dataRows.forEach(tr => {
          const cells = tr.querySelectorAll('td');
          
          if (cells.length === 0) {
            return; // Skip empty rows
          }
          
          // Get the FIRM cell content
          const firmCell = cells[firmIndex];
          if (!firmCell) {
            return;
          }
          
          const firmText = firmCell.textContent.trim();
          
          // Parse company name and location from FIRM column
          // Format: "Company Name, Location, State" or "Company Name, City, State"
          let companyName = '';
          let location = '';
          
          if (firmText.includes(',')) {
            const parts = firmText.split(',').map(p => p.trim());
            companyName = parts[0]; // Everything before first comma
            
            // Location is everything after first comma
            if (parts.length > 1) {
              location = parts.slice(1).join(', ');
            }
          } else {
            // No comma found, treat entire text as company name
            companyName = firmText;
            location = '';
          }
          
          // Build row data with only the columns we want
          const rowData = {
            'Company Name': companyName,
            'Location': location
          };
          
          // Add RANK 2025 if it exists
          if (rank2025Index !== -1 && cells[rank2025Index]) {
            rowData['RANK 2025'] = cells[rank2025Index].textContent.trim();
          }
          
          // Add RANK 2024 if it exists
          if (rank2024Index !== -1 && cells[rank2024Index]) {
            rowData['RANK 2024'] = cells[rank2024Index].textContent.trim();
          }
          
          rows.push(rowData);
        });
        
        // Only add table if it has data
        if (rows.length > 0) {
          tablesResults.push({
            tableIndex: tableIndex,
            headers: ['RANK 2025', 'RANK 2024', 'Company Name', 'Location'],
            data: rows,
            rowCount: rows.length
          });
        }
      });
      
      return tablesResults;
    });
    
    if (allTablesData && allTablesData.length > 0) {
      const totalRows = allTablesData.reduce((sum, table) => sum + table.rowCount, 0);
      console.log(`    ✅ Extracted ${totalRows} rows from ${allTablesData.length} table(s)`);
      
      // Combine all table data
      const combinedData = [];
      allTablesData.forEach(tableData => {
        combinedData.push(...tableData.data);
      });
      
      return {
        headers: ['RANK 2025', 'RANK 2024', 'Company Name', 'Location'],
        data: combinedData,
        tablesFound: allTablesData.length
      };
    } else {
      console.log('    ⚠️  No valid data tables found');
      return null;
    }
    
  } catch (error) {
    console.error(`    Error extracting table data: ${error.message}`);
    return null;
  }
}

// Visits a toplist page, detects pagination, and crawls all paginated pages to collect complete dataset
// Returns combined data from main page and all pagination pages with metadata (list name, URL, row count)
async function crawlToplistPage(page, url, listName) {
  console.log(`\n🔍 Crawling: ${listName}`);
  console.log(`📍 URL: ${url}`);
  
  try {
    // Navigate to main page
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    // Check for Cloudflare challenge
    await waitForCloudflareChallenge(page);
    
    // Wait a bit for dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check for pagination
    const paginationLinks = await getPaginationLinks(page);
    
    // Collect all data (from main page + paginated pages)
    const allData = [];
    
    // Extract data from the current page (first page or non-paginated page)
    console.log('  📄 Processing page 1...');
    const mainPageData = await extractTableData(page, url);
    if (mainPageData && mainPageData.data) {
      allData.push(...mainPageData.data);
    }
    
    // If pagination exists, crawl all paginated pages
    if (paginationLinks.length > 0) {
      for (let i = 0; i < paginationLinks.length; i++) {
        const paginationLink = paginationLinks[i];
        console.log(`  📄 Processing page ${i + 2} (${paginationLink.text})...`);
        console.log(`     URL: ${paginationLink.href}`);
        
        try {
          await page.goto(paginationLink.href, { 
            waitUntil: 'domcontentloaded',
            timeout: 60000
          });
          
          await waitForCloudflareChallenge(page);
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const pageData = await extractTableData(page, paginationLink.href);
          if (pageData && pageData.data) {
            allData.push(...pageData.data);
          }
          
          // Be nice to the server between paginated pages
          await new Promise(resolve => setTimeout(resolve, 1500));
          
        } catch (error) {
          console.error(`     ❌ Error crawling pagination page: ${error.message}`);
        }
      }
    }
    
    if (allData.length > 0) {
      console.log(`  ✅ Total rows collected: ${allData.length}`);
      
      return {
        listName: listName,
        url: url,
        headers: ['RANK 2025', 'RANK 2024', 'Company Name', 'Location'],
        data: allData,
        rowCount: allData.length,
        paginatedPages: paginationLinks.length > 0 ? paginationLinks.length + 1 : 1
      };
    }
    
    return null;
    
  } catch (error) {
    console.error(`  ❌ Error crawling ${url}: ${error.message}`);
    return null;
  }
}

// Extracts all toplist links from the main /toplists page using multiple selector strategies
// Returns deduplicated array of links with href and text for each individual toplist
async function getToplistLinks(page) {
  console.log('\n📋 Getting toplist links...');
  
  const links = await page.evaluate(() => {
    const linkArray = [];
    
    // Try various selectors
    const selectors = [
      'div.linkArrow a',
      '.linkArrow a',
      'a[href*="toplists"]',
      'a[href*="rankings"]',
      'a.link-arrow',
      '.link-arrow a',
      'div[class*="arrow"] a'
    ];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        elements.forEach(a => {
          if (a.href && a.href.includes('toplists')) {
            linkArray.push({
              href: a.href,
              text: a.textContent.trim()
            });
          }
        });
        if (linkArray.length > 0) break;
      }
    }
    
    // Fallback: get all links containing 'toplists'
    if (linkArray.length === 0) {
      document.querySelectorAll('a').forEach(a => {
        if (a.href && a.href.includes('toplists') && !a.href.endsWith('/toplists')) {
          linkArray.push({
            href: a.href,
            text: a.textContent.trim()
          });
        }
      });
    }
    
    // Remove duplicates
    const uniqueLinks = [];
    const seenUrls = new Set();
    
    linkArray.forEach(link => {
      if (!seenUrls.has(link.href)) {
        seenUrls.add(link.href);
        uniqueLinks.push(link);
      }
    });
    
    return uniqueLinks;
  });
  
  console.log(`✅ Found ${links.length} toplist links`);
  return links;
}

// Main orchestration function that launches browser, navigates through all toplists, and extracts complete datasets
// Saves results to JSON file and returns array of all toplist data with rankings and company information
async function crawlENRToplists() {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/usr/bin/chromium-browser',
    userDataDir: './chrome-profile',
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });
  
  const page = await browser.newPage();
  
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
  });
  
  const cookiesPath = './enr-cookies.json';
  if (fs.existsSync(cookiesPath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
    await page.setCookie(...cookies);
  }
  
  try {
    // Step 1: Load homepage
    console.log('🌐 Step 1: Loading homepage...');
    await page.goto('https://www.enr.com/', { 
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const challengePassed = await waitForCloudflareChallenge(page);
    
    if (!challengePassed) {
      throw new Error('Failed to pass Cloudflare challenge');
    }
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 2: Navigate to toplists
    console.log('\n🌐 Step 2: Navigating to toplists page...');
    await page.goto('https://www.enr.com/toplists', { 
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    await waitForCloudflareChallenge(page);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 3: Get all toplist links
    const toplistLinks = await getToplistLinks(page);
    
    if (toplistLinks.length === 0) {
      console.log('⚠️  No toplist links found!');
      
      // Save debug info
      await page.screenshot({ path: 'debug-no-links.png', fullPage: true });
      const html = await page.content();
      fs.writeFileSync('debug-no-links.html', html);
      
      console.log('Debug files saved: debug-no-links.png and debug-no-links.html');
    }
    
    // Step 4: Crawl each toplist page (including pagination)
    console.log(`\n🚀 Step 3: Crawling ${toplistLinks.length} toplist pages...`);
    const allResults = [];
    
    for (let i = 0; i < toplistLinks.length; i++) {
      const link = toplistLinks[i];
      console.log(`\n[${'='.repeat(60)}]`);
      console.log(`[${i + 1}/${toplistLinks.length}]`);
      
      const result = await crawlToplistPage(page, link.href, link.text);
      
      if (result) {
        allResults.push(result);
      }
      
      // Be nice to the server between different toplists
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Step 5: Save results
    console.log('\n' + '='.repeat(70));
    console.log('💾 SAVING RESULTS...');
    console.log('='.repeat(70));
    
    // Create output directory if it doesn't exist
    const outputDir = './enr-data';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
      console.log(`📁 Created directory: ${outputDir}`);
    }
    
    // Save each toplist as a separate JSON file
    allResults.forEach((result, index) => {
      // Extract filename from URL or use listName
      let filename = '';
      
      // Try to get filename from URL (e.g., "2025-Top-500-Design-Firms")
      const urlParts = result.url.split('/');
      const lastPart = urlParts[urlParts.length - 1];
      
      if (lastPart && lastPart !== 'toplists') {
        filename = lastPart;
      } else {
        // Fallback: use listName and sanitize it
        filename = result.listName
          .replace(/[^a-z0-9]/gi, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
      }
      
      // Create individual file data
      const fileData = {
        crawlDate: new Date().toISOString(),
        listName: result.listName,
        url: result.url,
        totalRows: result.rowCount,
        paginatedPages: result.paginatedPages,
        headers: result.headers,
        data: result.data
      };
      
      const filepath = `${outputDir}/${filename}.json`;
      fs.writeFileSync(filepath, JSON.stringify(fileData, null, 2));
      console.log(`✅ Saved: ${filepath} (${result.rowCount} rows)`);
    });
    
    // Also save a summary file
    const summaryData = {
      crawlDate: new Date().toISOString(),
      totalLists: allResults.length,
      totalRows: allResults.reduce((sum, r) => sum + r.rowCount, 0),
      files: allResults.map(r => {
        const urlParts = r.url.split('/');
        const filename = urlParts[urlParts.length - 1] || r.listName.replace(/[^a-z0-9]/gi, '-');
        return {
          filename: `${filename}.json`,
          listName: r.listName,
          url: r.url,
          rowCount: r.rowCount,
          paginatedPages: r.paginatedPages
        };
      })
    };
    
    fs.writeFileSync(`${outputDir}/summary.json`, JSON.stringify(summaryData, null, 2));
    console.log(`✅ Saved: ${outputDir}/summary.json (index file)`);
    
    // Save cookies
    const cookies = await page.cookies();
    fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
    
    // Summary

    console.log('📊 CRAWL SUMMARY');
    console.log(`Total lists crawled: ${allResults.length}`);
    console.log(`Total rows extracted: ${allResults.reduce((sum, r) => sum + r.rowCount, 0)}`);
    console.log('\nResults by list:');
    allResults.forEach((result, i) => {
      const paginationInfo = result.paginatedPages > 1 
        ? ` (${result.paginatedPages} pages)` 
        : '';
      console.log(`  ${i + 1}. ${result.listName}: ${result.rowCount} rows${paginationInfo}`);
    });
    console.log('='.repeat(70));
    
    await browser.close();
    
    return allResults;
    
  } catch (error) {
    console.error('❌ Error:', error);
    try {
      await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
      console.log('Error screenshot saved');
    } catch (screenshotError) {
      console.log('Could not save error screenshot');
    }
    await browser.close();
    throw error;
  }
}

module.exports = { crawlENRToplists };