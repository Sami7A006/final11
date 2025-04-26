import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import puppeteer from "npm:puppeteer-core@22.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const CHROME_WS = Deno.env.get("CHROME_WS") || "ws://chrome:3000";

async function scrapeWithPuppeteer(url: string) {
  const browser = await puppeteer.connect({
    browserWSEndpoint: CHROME_WS,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Enable request interception
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for the content to load
    await page.waitForSelector('.product-listing', { timeout: 5000 });

    // Extract detailed information
    const data = await page.evaluate(() => {
      const products = Array.from(document.querySelectorAll('.product-listing'));
      return products.map(product => ({
        name: product.querySelector('.product-name')?.textContent?.trim(),
        score: product.querySelector('.product-score')?.textContent?.trim(),
        concerns: Array.from(product.querySelectorAll('.product-concerns li'))
          .map(concern => concern.textContent?.trim()),
        ingredients: Array.from(product.querySelectorAll('.product-ingredients li'))
          .map(ingredient => ingredient.textContent?.trim()),
        category: product.querySelector('.product-category')?.textContent?.trim(),
        certifications: Array.from(product.querySelectorAll('.product-certifications li'))
          .map(cert => cert.textContent?.trim()),
      }));
    });

    return data;
  } catch (error) {
    console.error('Puppeteer error:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

async function fetchWithRetry(url: string, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const ingredient = url.searchParams.get("ingredient");

    if (!ingredient) {
      return new Response(
        JSON.stringify({ error: "Ingredient parameter is required" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    const ewgUrl = `https://www.ewg.org/skindeep/search/?search=${encodeURIComponent(ingredient)}`;
    
    // Try Puppeteer first for detailed scraping
    try {
      const scrapedData = await scrapeWithPuppeteer(ewgUrl);
      return new Response(
        JSON.stringify({ data: scrapedData }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    } catch (error) {
      console.warn("Puppeteer scraping failed, falling back to basic fetch:", error);
      
      // Fallback to basic fetch
      const response = await fetchWithRetry(ewgUrl);
      const html = await response.text();

      return new Response(
        JSON.stringify({ html }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }
  } catch (error) {
    console.error("Error in EWG search function:", error);
    return new Response(
      JSON.stringify({ 
        error: "Failed to fetch EWG data",
        details: error.message 
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
});