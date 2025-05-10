const electron = require("electron");
const { app, BrowserWindow, Tray, Menu, screen, nativeImage, desktopCapturer } =
  electron;
const path = require("path");
const fs = require("fs");
const moment = require("moment");
const sharp = require("sharp");
const { createCanvas, loadImage } = require("canvas");
const OpenAI = require("openai");
const notifier = require("node-notifier");
const minimist = require("minimist");
const fetch = require("node-fetch");

const { supabaseClient } = require("./supabase");
const { geminiModel, gptModel } = require("./models");
const { generateText } = require("ai");

require("dotenv").config();

// Parse command line arguments
const argv = minimist(process.argv.slice(2), {
  string: ["analyze"], // --analyze=path/to/image.jpg
  boolean: ["help"], // --help
});

// Display help information and exit
function showHelp() {
  console.log(`
LinkedIn Productivity App - Screenshot and AI Analysis Tool

Usage:
  npm start                        Start the app in normal mode (taking screenshots)
  npm start -- --analyze=<path>    Analyze an existing image with OpenAI
  npm start -- --help              Show this help information

Options:
  --analyze=<path>    Path to an image file to analyze with OpenAI
  --help              Show this help information
`);
  app.exit(0);
}

// Prevent the app from showing in dock (macOS only)
if (process.platform === "darwin" && app.dock) {
  app.dock.hide();
}

let tray = null;
let screenshotInterval = null;
let batchFolderTimestamp = null;
const SCREENSHOT_INTERVAL = 10 * 1000 * 6; // 10 seconds
const BATCH_INTERVAL = 90 * 1000; // 90 seconds (for testing, should be 30 minutes)
const GRID_ROWS = 3;
const GRID_COLS = 3;

// Enable/disable desktop notifications
const ENABLE_NOTIFICATIONS = true;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// OpenAI models to use
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4-vision-preview";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

// Helper function to show desktop notifications
function showNotification(title, message, options = {}) {
  if (!ENABLE_NOTIFICATIONS) return;

  notifier.notify({
    title: title || "Yongatron",
    message: message,
    icon: path.join(app.getAppPath(), "app-icon.png"), // Optional app icon (create one if desired)
    sound: options.sound !== false, // True by default
    wait: options.wait || false, // Wait for user interaction
    timeout: options.timeout || 5, // Auto-close after 5 seconds by default
  });
}

// Ensure app only has a single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}

// Create directory for screenshots if it doesn't exist
function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return directory;
}

// Get the base directory for storing screenshots
function getScreenshotsBaseDir() {
  const userDataPath = app.getPath("userData");
  return ensureDirectoryExists(path.join(userDataPath, "screenshots"));
}

// Create a new batch folder based on current timestamp
function createNewBatchFolder() {
  batchFolderTimestamp = moment().format("YYYY-MM-DD_HH-mm-ss");
  const batchDir = path.join(getScreenshotsBaseDir(), batchFolderTimestamp);
  return ensureDirectoryExists(batchDir);
}

// Take a screenshot of the display containing the cursor
async function takeScreenshot() {
  try {
    // Get cursor position to identify which display the user is on
    const cursorPosition = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(cursorPosition);

    // If no batch folder exists or it's time for a new batch, create one
    if (!batchFolderTimestamp) {
      createNewBatchFolder();
    }

    // Get all displays to determine the index of the current display
    const allDisplays = screen.getAllDisplays();
    const displayIndex = allDisplays.findIndex(
      (display) => display.id === currentDisplay.id
    );

    // Generate filename with timestamp
    const timestamp = moment().format("YYYY-MM-DD_HH-mm-ss");
    const displayInfo = `display${displayIndex}`;
    const filename = `${timestamp}_${displayInfo}.png`;
    const filePath = path.join(
      getScreenshotsBaseDir(),
      batchFolderTimestamp,
      filename
    );

    // Get sources for all displays
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: currentDisplay.bounds.width,
        height: currentDisplay.bounds.height,
      },
    });

    // Find the source that corresponds to the display with the cursor
    // For single display, there will only be one source
    // For multiple displays, we need to find the right one
    let source;
    if (sources.length === 1) {
      // Single display case
      source = sources[0];
    } else {
      // Multi-display case
      // The source ID typically contains the display ID or index
      // Find the source that matches our display index or ID
      // Different Electron versions use different naming conventions:

      // In Electron 10+, the ID format is usually:
      // - "screen:0:0" for the first display
      // - "screen:1:0" for the second display
      // The first number corresponds to the display index

      const possiblePatterns = [
        `screen:${displayIndex}:`, // Common pattern
        `screen:${currentDisplay.id}:`, // Alternative pattern
        `display_${displayIndex}`, // Another possible pattern
        `display_${currentDisplay.id}`, // Another possible pattern
      ];

      source = sources.find(
        (s) =>
          possiblePatterns.some((pattern) => s.id.includes(pattern)) ||
          // As a fallback, check if the source name includes the display index
          s.name.includes(`Display ${displayIndex}`) ||
          s.name.includes(`Screen ${displayIndex}`)
      );

      // If we couldn't find a matching source, use the first one as a fallback
      if (!source) {
        // Log display info to help debug
        console.log(
          "Available sources:",
          sources.map((s) => ({ id: s.id, name: s.name }))
        );
        console.log("Looking for display:", {
          displayIndex,
          displayId: currentDisplay.id,
        });
        console.log("Using first source as fallback");
        source = sources[0];
      }
    }

    // Save the screenshot from the thumbnail
    if (source && source.thumbnail) {
      const pngBuffer = source.thumbnail.toPNG();
      fs.writeFileSync(filePath, pngBuffer);
      console.log(`Screenshot saved: ${filePath} (Source: ${source.id})`);

      // Show notification
      showNotification(
        "Screenshot Captured",
        `Screen ${displayIndex} captured at ${moment().format("HH:mm:ss")}`,
        { sound: false } // No sound for frequent screenshots
      );
    } else {
      throw new Error("No thumbnail available from the source");
    }
  } catch (error) {
    console.error("Error taking screenshot:", error);
    showNotification(
      "Screenshot Error",
      `Failed to capture screenshot: ${error.message}`,
      { sound: true } // Sound for errors
    );
  }
}

// Reset the batch every 30 minutes, create summary, analyze with OpenAI, and generate image
async function setupBatchReset() {
  setInterval(async () => {
    // Process previous batch
    if (batchFolderTimestamp) {
      const oldBatchTimestamp = batchFolderTimestamp;

      // Show notification for batch completion
      showNotification(
        "Batch Complete",
        `Completing batch: ${oldBatchTimestamp}. Creating summary...`,
        { sound: true }
      );

      // Create batch summary grid
      const summaryPath = await createBatchSummary(oldBatchTimestamp);

      // Create new batch folder (do this early so screenshots continue during analysis)
      createNewBatchFolder();

      // If we have a summary image, analyze it with OpenAI
      if (summaryPath) {
        // Show notification for summary creation
        showNotification(
          "Summary Created",
          `Batch summary grid created. Starting OpenAI analysis...`,
          { sound: false }
        );

        // Use the compressed JPEG version for OpenAI to reduce size
        const compressedPath = summaryPath.replace(".png", "_compressed.jpg");
        if (fs.existsSync(compressedPath)) {
          console.log(`Analyzing batch summary with OpenAI: ${compressedPath}`);
          const analysisResult = await analyzeImageWithOpenAI(compressedPath);

          // Save the analysis result
          const outputDir = path.dirname(compressedPath);
          const baseName = path
            .basename(compressedPath, path.extname(compressedPath))
            .replace("_compressed", "");
          const analysisFilePath = path.join(
            outputDir,
            `${baseName}_analysis.txt`
          );
          fs.writeFileSync(analysisFilePath, analysisResult);
          console.log(`OpenAI analysis saved to: ${analysisFilePath}`);

          // Generate a LinkedIn header image based on the analysis text
          const headerImagePath = await generateLinkedInImage(
            analysisResult,
            outputDir,
            baseName
          );

          // Send to webhook
          let webhookSent = false;
          if (headerImagePath) {
            webhookSent = await sendToWebhook(analysisResult, headerImagePath);
          }

          if (headerImagePath) {
            // Show notification for complete workflow
            let message = `LinkedIn post and header image created successfully!`;
            if (webhookSent) {
              message = `LinkedIn content sent to webhook successfully!`;
            }

            showNotification("Process Complete", message, {
              sound: true,
              timeout: 10,
              wait: true,
            });
          }
        } else {
          console.error(
            `Compressed summary image not found: ${compressedPath}`
          );
          showNotification(
            "Analysis Error",
            `Compressed summary image not found: ${compressedPath}`,
            { sound: true }
          );
        }
      }
    } else {
      // Create new batch folder if none exists
      createNewBatchFolder();

      // Show notification for new batch
      showNotification(
        "New Batch Started",
        `Starting new screenshot batch: ${batchFolderTimestamp}`,
        { sound: false }
      );
    }
  }, BATCH_INTERVAL);
}

// Log information about available displays for debugging
function logDisplayInfo() {
  try {
    const cursorPosition = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(cursorPosition);
    const allDisplays = screen.getAllDisplays();

    console.log(
      "Available displays:",
      allDisplays.map(
        (d, i) =>
          `Display ${i}: ID ${d.id}, Bounds: ${JSON.stringify(d.bounds)}`
      )
    );
    console.log("Cursor position:", cursorPosition);
    console.log("Cursor is on display ID:", currentDisplay.id);
  } catch (error) {
    console.error("Error logging display info:", error);
  }
}

// Function to generate an image with OpenAI based on text
async function generateLinkedInImage(textContent, outputDir, baseName) {
  try {
    // Check if API key is configured
    if (!process.env.OPENROUTER_API_KEY) {
      console.error(
        "OpenAI API key not found. Please set it in the .env file."
      );
      return null;
    }

    // Read the image prompt template
    const promptFilePath = path.join(
      app.getAppPath(),
      "linkedin_image_prompt.txt"
    );
    let promptTemplate;
    try {
      promptTemplate = fs.readFileSync(promptFilePath, "utf8");
    } catch (err) {
      console.error("Error reading image prompt file:", err);
      return null;
    }

    // Combine the template with the LinkedIn post text
    const fullPrompt = `${promptTemplate}\n\nLinkedIn post content:\n${textContent}`;

    console.log("Generating image with OpenAI...");
    console.log("Using model:", OPENAI_IMAGE_MODEL);

    showNotification(
      "Image Generation Started",
      "Creating LinkedIn header image...",
      { sound: false }
    );

    // Send request to OpenAI image generation API with gpt-image-1
    console.log(
      "Sending image generation request with model:",
      OPENAI_IMAGE_MODEL
    );

    const response = await openai.images.generate({
      model: OPENAI_IMAGE_MODEL,
      prompt: fullPrompt,
      n: 1,
      size: "1024x1024",
    });

    // Log a truncated response for debugging
    console.log("Response from OpenAI image generation received");

    // Check if we got a valid response
    if (!response || !response.data || !response.data[0]) {
      console.error("Invalid or empty response structure");
      throw new Error(
        "Invalid response structure from OpenAI image generation"
      );
    }

    if (!response.data[0].b64_json) {
      console.error("Response missing base64 data");
      throw new Error("Response missing image data");
    }

    // Get the base64 image data
    const image_base64 = response.data[0].b64_json;
    console.log("Received base64 image data");

    // Convert to buffer
    const buffer = Buffer.from(image_base64, "base64");

    // Create filename for the generated image
    const imageName = `${baseName}_linkedin_image.png`;
    const imagePath = path.join(outputDir, imageName);

    // Save the image
    fs.writeFileSync(imagePath, buffer);
    console.log(`LinkedIn image saved to: ${imagePath}`);

    showNotification(
      "Image Generation Complete",
      `LinkedIn image created: ${imageName}`,
      { sound: true }
    );

    return imagePath;
  } catch (error) {
    console.error("Error generating LinkedIn image:", error);
    showNotification(
      "Image Generation Error",
      `Failed to create LinkedIn header image: ${error.message}`,
      { sound: true }
    );
    return null;
  }
}

// Function to send content to webhook
async function sendToWebhook(textContent, imagePath) {
  try {
    // Check if webhook URL is configured
    if (!process.env.WEBHOOK_URL) {
      console.error("Webhook URL not found. Please set it in the .env file.");
      showNotification(
        "Webhook Error",
        "Webhook URL not configured. Please add WEBHOOK_URL to your .env file.",
        { sound: true }
      );
      return false;
    }

    console.log("Preparing to send content to webhook...");
    showNotification(
      "Webhook Request Started",
      "Preparing to send content to webhook...",
      { sound: false }
    );

    // Read the image file as base64 if provided
    let base64Image = null;
    if (imagePath && fs.existsSync(imagePath)) {
      console.log(`Reading image for webhook: ${imagePath}`);
      const imageBuffer = fs.readFileSync(imagePath);
      base64Image = imageBuffer.toString("base64");
    }

    // Prepare the payload
    const payload = {
      content: textContent,
      image: base64Image,
    };

    // Send to webhook
    console.log(`Sending content to webhook: ${process.env.WEBHOOK_URL}`);
    const response = await fetch(process.env.WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to send to webhook: ${response.statusText} - ${errorText}`
      );
    }

    console.log("Successfully sent to webhook");
    showNotification(
      "Webhook Success",
      "Content successfully sent to webhook!",
      { sound: true }
    );

    return true;
  } catch (error) {
    console.error("Error sending to webhook:", error);
    showNotification(
      "Webhook Error",
      `Failed to send to webhook: ${error.message}`,
      { sound: true }
    );
    return false;
  }
}

// Function to analyze the batch summary image with OpenAI
async function analyzeImageWithOpenAI(imagePath) {
  try {
    // Check if API key is configured
    if (!process.env.OPENROUTER_API_KEY) {
      console.error(
        "OpenRouter key not found. Please set it in the .env file."
      );
      return "OpenRouter key not configured. Please add OPENROUTER_API_KEY to your .env file.";
    }

    // Read the prompt from file
    const promptFilePath = path.join(
      app.getAppPath(),
      "analyse_image_prompt.txt"
    );

    let prompt;
    try {
      prompt = fs.readFileSync(promptFilePath, "utf8");
    } catch (err) {
      console.error("Error reading prompt file:", err);
      return "Error reading prompt file. Please ensure linkedin_text_prompt.txt exists.";
    }

    // Read the image file
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString("base64");

    console.log("Sending image to OpenAI for analysis...");

    showNotification(
      "OpenAI Analysis Started",
      "Analyzing batch summary with OpenAI...",
      { sound: false }
    );

    console.log("OpenAI model:", OPENAI_MODEL);
    console.log("Prompt:", prompt);

    const summary = await generateText({
      model: gptModel,
      messages: [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: [{ type: "image", image: base64Image }],
        },
      ],
    });

    // Create OpenAI API request

    // Extract and return the generated text
    const generatedContent = summary.text;

    console.log("OpenAI analysis complete:", summary);

    // Show notification for analysis completion
    showNotification(
      "Analysis Complete",
      `OpenAI has generated a LinkedIn post based on your screenshots!`,
      { sound: true, timeout: 10, wait: true }
    );

    return generatedContent;
  } catch (error) {
    console.error("Error analyzing image with OpenAI:", error);
    return `Error analyzing image: ${error.message}`;
  }
}

// Create a batch summary image that combines all screenshots into a grid
async function createBatchSummary(batchTimestamp) {
  try {
    console.log(`Creating batch summary for: ${batchTimestamp}`);

    // Get the batch directory
    const batchDir = path.join(getScreenshotsBaseDir(), batchTimestamp);

    // Ensure the directory exists
    if (!fs.existsSync(batchDir)) {
      console.error(`Batch directory does not exist: ${batchDir}`);
      return;
    }

    // Get all PNG files in the batch directory
    const files = fs
      .readdirSync(batchDir)
      .filter((file) => file.endsWith(".png"))
      .sort(); // Sort by name (which includes timestamp)

    if (files.length === 0) {
      console.log(`No screenshots found in batch: ${batchTimestamp}`);
      return;
    }

    console.log(`Found ${files.length} screenshots in batch`);

    // Determine the grid layout (3x3 by default)
    const totalCells = GRID_ROWS * GRID_COLS;

    // Load the first image to get dimensions for the canvas
    const firstImagePath = path.join(batchDir, files[0]);
    const firstImageMetadata = await sharp(firstImagePath).metadata();
    const { width: singleWidth, height: singleHeight } = firstImageMetadata;

    // Define padding and font settings
    const padding = 20; // Pixels of padding between images
    const labelHeight = 40; // Height for timestamp labels
    const fontSize = 20;
    const fontFamily = "Arial";

    // Calculate full canvas dimensions
    const titleHeight = 40; // Height for the title at the top
    const canvasWidth =
      singleWidth * GRID_COLS + padding * (GRID_COLS - 1) + padding * 2; // Add padding on sides
    const canvasHeight =
      titleHeight + // Space for title
      singleHeight * GRID_ROWS +
      padding * (GRID_ROWS - 1) +
      labelHeight * GRID_ROWS +
      padding * 2; // Add padding on top/bottom

    // Create a canvas for the grid
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext("2d");

    // Fill background with dark gray
    ctx.fillStyle = "#333333";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Add a title to the grid with the batch timestamp
    const readableBatchTime = moment(
      batchTimestamp,
      "YYYY-MM-DD_HH-mm-ss"
    ).format("YYYY-MM-DD HH:mm:ss");
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${fontSize + 4}px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.fillText(
      `Batch Summary: ${readableBatchTime}`,
      canvasWidth / 2,
      padding + titleHeight / 2
    );

    // Prepare to load and draw images
    const filesToProcess = Math.min(files.length, totalCells);
    console.log(`Processing ${filesToProcess} images for the grid`);

    // Load and draw each image
    for (let i = 0; i < filesToProcess; i++) {
      const file = files[i];
      const row = Math.floor(i / GRID_COLS);
      const col = i % GRID_COLS;

      // Calculate position (account for padding and title)
      const x = padding + col * (singleWidth + padding);
      const y =
        padding + titleHeight + row * (singleHeight + padding + labelHeight);

      // Load the image
      const imagePath = path.join(batchDir, file);
      console.log(`Loading image: ${imagePath}`);
      const image = await loadImage(imagePath);

      // Draw a border around each screenshot
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x - 2, y - 2, singleWidth + 4, singleHeight + 4);

      // Draw the image
      ctx.drawImage(image, x, y, singleWidth, singleHeight);

      // Extract timestamp from filename
      const timestampMatch = file.match(
        /(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/
      );
      const timestamp = timestampMatch ? timestampMatch[0] : "Unknown";

      // Format the timestamp for display
      const formattedTime = moment(timestamp, "YYYY-MM-DD_HH-mm-ss").format(
        "HH:mm:ss"
      );

      // Draw a background for timestamp label
      ctx.fillStyle = "#000000";
      ctx.fillRect(x, y + singleHeight, singleWidth, labelHeight);

      // Add timestamp label below image
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${fontSize}px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText(
        formattedTime,
        x + singleWidth / 2,
        y + singleHeight + labelHeight / 2 + fontSize / 3
      );
    }

    // Save the grid image as PNG (high quality)
    const gridPngFilename = `batch_summary_${batchTimestamp}.png`;
    const gridPngFilePath = path.join(batchDir, gridPngFilename);

    // Convert canvas to buffer and save PNG
    const pngBuffer = canvas.toBuffer("image/png");
    fs.writeFileSync(gridPngFilePath, pngBuffer);
    console.log(`Batch summary (PNG) saved: ${gridPngFilePath}`);

    // Create a compressed JPEG version with reduced size
    try {
      // Define target size for compressed image (scale factor)
      const scaleFactor = 0.5; // 50% of original size

      // Calculate new dimensions
      const jpegWidth = Math.round(canvasWidth * scaleFactor);
      const jpegHeight = Math.round(canvasHeight * scaleFactor);

      // Resize and compress using Sharp
      const gridJpegFilename = `batch_summary_${batchTimestamp}_compressed.jpg`;
      const gridJpegFilePath = path.join(batchDir, gridJpegFilename);

      await sharp(pngBuffer)
        .resize(jpegWidth, jpegHeight)
        .jpeg({ quality: 70 }) // Reduce quality to save space
        .toFile(gridJpegFilePath);

      console.log(`Compressed batch summary (JPEG) saved: ${gridJpegFilePath}`);
    } catch (compressionError) {
      console.error(
        "Error creating compressed batch summary:",
        compressionError
      );
    }

    return gridPngFilePath;
  } catch (error) {
    console.error("Error creating batch summary:", error);
  }
}

// Set up the tray icon and menu
function createTray() {
  // Use a template image for the tray, which is better supported across platforms
  const iconImage = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA9ElEQVR42mNkYGBgZGJi+s/AwPAfyGZEmscIxP+A+D+U/Q+K0dWzMJAJMA1gIRXjMoDVAJIN4WAgE2AbwEoqxmYA3ABuUpXjMoQFiLnJdP03IH7DQAbAZoAZAwUAYkAPAwWAkZQ0MEVuv5iPjwfhBCBmBeJLQHwRiE8C8QEg3gnEh4H4DHZncUENYCLDohdA/ACIHwLxPiDeBMR1QOwMxHpArAzEQkAsAMTnsTmRBd0LTGQYcBGI9wDxXCBuAuIkIE4G4kIgtgJiJSA2BWIbJEPQ0wIjmRHJDcSBQBwExMVAnAXE8UAsCsS8SEGKmQ4QaYFUwAgAmCRETjRFYpEAAAAASUVORK5CYII="
  );
  tray = new Tray(iconImage);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Yongatron (Running)",
      enabled: false,
    },
    {
      label: "Open Screenshots Folder",
      click: () => {
        const { shell } = require("electron");
        shell.openPath(getScreenshotsBaseDir());
      },
    },
    {
      label: "Generate Current Batch Summary",
      click: async () => {
        if (batchFolderTimestamp) {
          const summaryPath = await createBatchSummary(batchFolderTimestamp);
          if (summaryPath) {
            const { shell } = require("electron");
            shell.openPath(path.dirname(summaryPath));
          }
        } else {
          console.log("No active batch to summarize");
        }
      },
    },
    {
      label: "Analyze Batch & Generate LinkedIn Content",
      click: async () => {
        if (batchFolderTimestamp) {
          // First make sure we have a summary
          const summaryPath = await createBatchSummary(batchFolderTimestamp);

          if (summaryPath) {
            const compressedPath = summaryPath.replace(
              ".png",
              "_compressed.jpg"
            );

            if (fs.existsSync(compressedPath)) {
              // Display notification
              showNotification(
                "Process Started",
                "Analyzing screenshots and generating LinkedIn content...",
                { sound: true }
              );

              console.log(
                `Analyzing batch summary with OpenAI: ${compressedPath}`
              );

              // Get the text content from OpenAI
              const analysisResult = await analyzeImageWithOpenAI(
                compressedPath
              );

              // Save the analysis result
              const outputDir = path.dirname(compressedPath);
              const baseName = path
                .basename(compressedPath, path.extname(compressedPath))
                .replace("_compressed", "");
              const analysisFilePath = path.join(
                outputDir,
                `${baseName}_analysis.txt`
              );
              fs.writeFileSync(analysisFilePath, analysisResult);
              console.log(`OpenAI analysis saved to: ${analysisFilePath}`);

              // Generate a LinkedIn header image based on the analysis text
              const headerImagePath = await generateLinkedInImage(
                analysisResult,
                outputDir,
                baseName
              );

              // Send to webhook
              let webhookSent = false;
              if (headerImagePath) {
                webhookSent = await sendToWebhook(
                  analysisResult,
                  headerImagePath
                );
              }

              if (headerImagePath) {
                // Show success notification
                let message = `LinkedIn post and header image created successfully!`;
                if (webhookSent) {
                  message = `LinkedIn content sent to webhook successfully!`;
                }

                showNotification("Process Complete", message, {
                  sound: true,
                  wait: true,
                });
              }

              // Open the folder containing the generated content
              const { shell } = require("electron");
              shell.openPath(outputDir);
            } else {
              console.error(
                `Compressed summary image not found: ${compressedPath}`
              );
              showNotification("Error", "Compressed summary image not found", {
                sound: true,
              });
            }
          }
        } else {
          console.log("No active batch to analyze");
          showNotification(
            "No Active Batch",
            "There is no active batch to analyze",
            { sound: true }
          );
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        clearInterval(screenshotInterval);
        app.quit();
      },
    },
  ]);

  tray.setToolTip("Yongatron");
  tray.setContextMenu(contextMenu);
}

// Function to handle direct image analysis without taking screenshots
async function analyzeExistingImage(imagePath) {
  try {
    // Check if the file exists
    if (!fs.existsSync(imagePath)) {
      console.error(`Error: Image file not found at: ${imagePath}`);
      showNotification("Error", `Image file not found at: ${imagePath}`, {
        sound: true,
      });
      app.exit(1);
      return;
    }

    // Check if the path is a valid image file
    const fileExt = path.extname(imagePath).toLowerCase();
    const validExts = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    if (!validExts.includes(fileExt)) {
      console.error(`Error: Not a valid image file: ${imagePath}`);
      showNotification("Error", `Not a valid image file: ${imagePath}`, {
        sound: true,
      });
      app.exit(1);
      return;
    }

    console.log(`Analyzing image: ${imagePath}`);
    showNotification(
      "OpenAI Analysis",
      `Analyzing image: ${path.basename(imagePath)}`,
      { sound: true }
    );

    // Analyze the image with OpenAI
    const result = await analyzeImageWithOpenAI(imagePath);

    // Define output paths
    const outputDir = path.dirname(imagePath);
    const baseName = path.basename(imagePath, path.extname(imagePath));
    const analysisFilePath = path.join(outputDir, `${baseName}_analysis.txt`);

    // Save the analysis result
    fs.writeFileSync(analysisFilePath, result);
    console.log(`Analysis saved to: ${analysisFilePath}`);

    showNotification(
      "Analysis Complete",
      `Analysis saved to: ${analysisFilePath}`,
      {
        sound: true,
      }
    );

    // Generate a LinkedIn header image based on the analysis text
    showNotification("Generating Image", "Creating LinkedIn header image...", {
      sound: false,
    });

    const headerImagePath = await generateLinkedInImage(
      result,
      outputDir,
      baseName
    );

    // Send to webhook
    let webhookSent = false;
    if (headerImagePath) {
      webhookSent = await sendToWebhook(result, headerImagePath);
    }

    if (headerImagePath) {
      // Show success notification
      let message = `LinkedIn post and header image created successfully!`;
      if (webhookSent) {
        message = `LinkedIn content sent to webhook successfully!`;
      }

      showNotification("Process Complete", message, {
        sound: true,
        wait: true,
      });
    }

    // Open the directory containing the files
    const { shell } = require("electron");
    shell.openPath(outputDir);

    // Exit after analysis is complete (with a delay to ensure files are saved)
    setTimeout(() => app.exit(0), 3000);
  } catch (error) {
    console.error("Error analyzing image:", error);
    showNotification(
      "Analysis Error",
      `Failed to analyze image: ${error.message}`,
      { sound: true }
    );
    app.exit(1);
  }
}

// App initialization
app.on("ready", () => {
  // Check for command line arguments
  if (argv.help) {
    showHelp();
    return;
  }

  if (argv.analyze) {
    // Direct analysis mode - analyze existing image without taking screenshots
    analyzeExistingImage(argv.analyze);
    return;
  }

  // Normal screenshot mode
  // Show startup notification
  showNotification(
    "Yongatron Started",
    `Screenshot service running. Interval: ${
      SCREENSHOT_INTERVAL / 1000
    }s, Batch: ${BATCH_INTERVAL / 1000}s`,
    { sound: true, wait: false, timeout: 5 }
  );

  // Set up tray icon
  createTray();

  // Create initial batch folder
  createNewBatchFolder();

  // Log information about displays
  logDisplayInfo();

  // Start taking screenshots at regular intervals
  screenshotInterval = setInterval(takeScreenshot, SCREENSHOT_INTERVAL);

  // Take an initial screenshot
  takeScreenshot();

  // Set up batch reset interval
  setupBatchReset();
});

// Prevent app from closing when all windows are closed (since we don't have any windows)
app.on("window-all-closed", () => {
  // Do nothing, preventing the app from quitting
});

// Keep the app alive in the background
app.on("activate", () => {
  // No windows to create since we're running in the background
});
