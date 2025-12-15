const { crawlENRToplists } = require('./controllers/crawler');

async function main() {
  try {
    console.log('Starting ENR toplists crawler...');
    const links = await crawlENRToplists();

    console.log(`Total links found: ${links.length}`);
    console.log('\nLinks:');
    links.forEach((link, index) => {
      console.log(`${index + 1}. ${link}`);
    });
    
  } catch (error) {
    console.error('Failed to crawl:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}