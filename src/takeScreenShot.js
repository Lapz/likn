// Take a screenshot of the display containing the cursor
export async function takeScreenshot() {
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
