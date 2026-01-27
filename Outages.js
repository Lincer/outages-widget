// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: bolt;
const fm =  FileManager.iCloud().isFileStoredIniCloud(module.filename)
    ? FileManager.iCloud()
    : FileManager.local();

// Get the subqueue number from the widget parameter, default is 1.1
const subqueueParam = args.widgetParameter ?? '1.1';
const isInversed = subqueueParam.endsWith('є');
const subqueueNumber = isInversed ? subqueueParam.slice(0, -1) : subqueueParam;

// Auto-update configuration
const scriptName = 'Outages';
const rawUrl = `https://raw.githubusercontent.com/Lincer/outages-widget/main/${scriptName}.js`;
const currentVersion = "1.3.1";

// Check for updates
async function checkForUpdates() {
  try {
    const req = new Request(rawUrl);
    const updatedCode = await req.loadString();

    // Simple version check: look for currentVersion in the remote file
    const versionMatch = updatedCode.match(/const currentVersion = "([^"]+)"/);
    if (versionMatch && versionMatch[1] !== currentVersion) {
      const scriptPath = fm.joinPath(fm.documentsDirectory(), `${scriptName}.js`);

      if (fm.isFileStoredIniCloud(scriptPath)) {
        await fm.downloadFileFromiCloud(scriptPath);
      }

      fm.writeString(scriptPath, updatedCode);

      Script.complete();
      return true;
    }
  } catch (e) {
    console.log('Update check failed: ' + e.message);
  }
  return false;
}

// Run update check
await checkForUpdates();

// Get outage times
const apiURL = "https://outages-widget.netlify.app/.netlify/functions/getOutages";
const cachePath = fm.joinPath(fm.documentsDirectory(), `outages_cache.json`);
let timeStrings = [];
let outagesDate = '';

try {
  const request = new Request(apiURL)
  const outagesData = await request.loadJSON()

  // save to cache
  fm.writeString(cachePath, JSON.stringify(outagesData));

  outagesDate = outagesData.date;
  timeStrings = outagesData.subqueues[subqueueNumber];
} catch (e) {
  // if the update failed, take times from the cache
  if (fm.fileExists(cachePath)) {
    const cacheContent = JSON.parse(fm.readString(cachePath));
    outagesDate = cacheContent.date;
    timeStrings = cacheContent.subqueues[subqueueNumber];
  }
}

// Invert time slots if requested
if (isInversed && timeStrings.length > 0) {
  let inverted = [];
  let lastEnd = "00:00";

  timeStrings.forEach(slot => {
    const [start, end] = slot.split(" - ");
    if (start !== lastEnd) {
      inverted.push(`${lastEnd} - ${start}`);
    }
    lastEnd = end;
  });

  if (lastEnd !== "24:00") {
    inverted.push(`${lastEnd} - 24:00`);
  }
  timeStrings = inverted;
}

// Widget layout
// gradient background for the widget
function createGradientBackground(widget, colors) {
  const gradient = new LinearGradient();
  gradient.colors = colors;
  gradient.locations = [0, 1];
  widget.backgroundGradient = gradient;
}

// create widget
const widget = new ListWidget();
widget.url = "https://hoe.com.ua/page/pogodinni-vidkljuchennja";
const BACKGROUND_COLOR = [new Color("#2e5387"), new Color("#395a81")];
createGradientBackground(widget, BACKGROUND_COLOR);

// header row
const headerRow = widget.addStack();
headerRow.centerAlignContent();

// header icon
const symbol = SFSymbol.named("bolt.fill")
const image = symbol.image
const img = headerRow.addImage(image)
img.imageSize = new Size(24, 24)
img.tintColor = isInversed ? Color.green() : Color.red();

headerRow.addSpacer(5);

// header text
const headerText = headerRow.addText(`${subqueueNumber} на ${outagesDate}:`);
headerText.textColor = new Color("#e4e3df");
headerText.font = Font.boldSystemFont(14);
headerText.leftAlignText();

widget.addSpacer(10);

// add all time slots
timeStrings.forEach(time => {
  const nameText = widget.addText(time);
  nameText.textColor = new Color("#e4e3df");
  nameText.font = Font.regularSystemFont(16);
  nameText.leftAlignText();

  widget.addSpacer(10);
})

Script.setWidget(widget);
widget.presentSmall();
Script.complete();