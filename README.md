# LinkedIn Producitivty app

A background app that periodically captures screenshots and organizes them into timed batches.

## Features

- Runs silently in the background with only a menu bar icon visible
- Takes screenshots every minute, capturing only the display that currently contains the cursor using Electron's native desktopCapturer API
- Organizes screenshots into 30-minute batches
- Each batch is stored in a separate folder named with its start timestamp
- Automatically generates summary grid images at the end of each batch:
  - High-quality PNG version with full resolution
  - Compressed JPEG version at 50% size for easier sharing
- Grid summary shows screenshots in a 3x3 layout with clearly labeled timestamps
- Sends compressed batch summaries to OpenAI for analysis
- Generates LinkedIn-ready post suggestions based on your screenshot activity
- Creates custom images for LinkedIn posts using GPT-image-1
- Provides desktop notifications for key events during testing
- Access your screenshots easily through the menu bar icon
- Generate current batch summary or create LinkedIn content (text + image) on demand

## Installation

### Development

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm start` to launch the app in development mode

### Production

1. Run `npm run build` to build the application
2. Install the generated package from the `dist` folder

## Usage

### Normal Mode

Once installed, the app runs automatically in the background. You can access the following features from the menu bar icon:

- **Open Screenshots Folder**: Opens the folder containing your screenshot batches
- **Generate Current Batch Summary**: Creates a grid of screenshots from the current batch
- **Analyze Current Batch with OpenAI**: Analyzes the batch with OpenAI and generates LinkedIn content
- **Quit**: Exits the application

### Direct Analysis Mode

You can also analyze an existing image directly without taking screenshots:

```bash
# Analyze an existing image
npm run analyze -- path/to/your/image.jpg

# Show help information
npm start -- --help
```

This is useful for:

- Testing the OpenAI integration with existing images
- Generating LinkedIn content from previous screenshots
- Debug and development without waiting for screenshot batches

## Technical Details

- Screenshots are stored in the app's user data directory
- Each batch folder contains screenshots from a 30-minute period
- Screenshots are named with their exact timestamp in YYYY-MM-DD_HH-mm-ss format

## License

ISC
