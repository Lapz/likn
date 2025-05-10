// Log information about available displays for debugging
export function logDisplayInfo() {
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
