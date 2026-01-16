// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: bolt;
const fm = FileManager.local();

// Get the subqueue number from widget parameter, default is 1.1
const subqueueNumber = args.widgetParameter ?? '1.1';

// Auto-update configuration
const scriptName = 'Outages';
const repoUser = 'Lincer';
const repoName = 'outages-widget';
const rawUrl = `https://raw.githubusercontent.com/${repoUser}/${repoName}/main/${scriptName}.js`;
const currentVersion = "1.0.0";

// Check for updates
async function checkForUpdates() {
  const lastCheckPath = fm.joinPath(fm.documentsDirectory(), `last_update_check_${scriptName}.json`);
  const today = new Date().toLocaleDateString();

  // Check only once a day
  if (fm.fileExists(lastCheckPath)) {
    const lastCheck = fm.readString(lastCheckPath);
    if (lastCheck === today) {
      return false;
    }
  }

  try {
    const req = new Request(rawUrl);
    const updatedCode = await req.loadString();
    
    // Simple version check: look for currentVersion in the remote file
    const versionMatch = updatedCode.match(/const currentVersion = '([^']+)'/);
    
    fm.writeString(lastCheckPath, today);

    if (versionMatch && versionMatch[1] !== currentVersion) {
      const scriptPath = fm.joinPath(fm.documentsDirectory(), `${scriptName}.js`);
      fm.writeString(scriptPath, updatedCode);
      return true;
    }
  } catch (e) {
    console.log('Update check failed: ' + e.message);
  }
  return false;
}

// Run update check
await checkForUpdates();

// Get outage time from the site
const url = 'https://hoe.com.ua/page/pogodinni-vidkljuchennja'
const cachePath = fm.joinPath(fm.documentsDirectory(), `outages_cache_${subqueueNumber}.json`);
let timeStrings = [];

try {
  const req = new Request(url)
  const html = await req.loadString()
  const outagesString = html.match(new RegExp(`підчерга\\s${subqueueNumber}\\s–\\s([^;\\n]+)`));
  if (outagesString && outagesString[1]) {
    timeStrings = [...outagesString[1].matchAll(/(\d{2}:\d{2})\sдо\s(\d{2}:\d{2})/g)]
        .map(m => `${m[1]} - ${m[2]}`);
    
    // save to cache
    fm.writeString(cachePath, JSON.stringify(timeStrings));
  } else {
    throw new Error("Could not parse outages from HTML");
  }
} catch (e) {
  // if the update failed, take times from the cache
  if (fm.fileExists(cachePath)) {
    const cacheContent = fm.readString(cachePath);
    timeStrings = JSON.parse(cacheContent);
  }
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

headerRow.addSpacer(5);

// header text
const headerText = headerRow.addText(`Відключення для черги ${subqueueNumber}`);
headerText.textColor = new Color("#e4e3df");
headerText.font = Font.boldSystemFont(14);
headerText.leftAlignText();

widget.addSpacer(10);

// add all time slots
timeStrings.forEach(time => {
  const nameText = widget.addText(time);
  nameText.textColor = new Color("#e4e3df");
  nameText.font = Font.boldSystemFont(16);
  nameText.leftAlignText();

  widget.addSpacer(10);
})

Script.setWidget(widget);
widget.presentSmall();
Script.complete();