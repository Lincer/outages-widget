import fetch from "node-fetch"
import { createCanvas, loadImage } from "canvas"
import fs from "fs"

const PAGE_URL = "https://hoe.com.ua/page/pogodinni-vidkljuchennja"

let outagesDate = '';
let results = {};

// image grid config
const gridConfig = {
    left: 160,
    top: 312,
    cellWidth: 58,
    cellHeight: 53,
    hours: 24,
    subqueues: [
        "1.1","1.2",
        "2.1","2.2",
        "3.1","3.2",
        "4.1","4.2",
        "5.1","5.2",
        "6.1","6.2"
    ]
}

async function getScheduleImageUrl() {
    const res = await fetch(PAGE_URL)
    const html = await res.text()

    // find first <img> with alt containing "ГПВ"
    const imgMatch = html.match(
        /<img[^>]+alt=["']([^"']*ГПВ[^"']*)["'][^>]+src=["']([^"']+)["']/i
    )

    if (!imgMatch) {
        throw new Error("Schedule image was not found")
    }

    const alt = imgMatch[1]
    let src = imgMatch[2]

    outagesDate = extractDateFromAlt(alt)

    return `https://hoe.com.ua${src}`
}

function extractDateFromAlt(alt) {
    const m = alt.match(/(\d{2})\.(\d{2})\.\d{2}/)
    if (!m) return null

    return `${m[1]}.${m[2]}`
}

// --------------------------------------
function colorDistance(r1, g1, b1, r2, g2, b2) {
    return Math.sqrt(
        Math.pow(r1 - r2, 2) +
        Math.pow(g1 - g2, 2) +
        Math.pow(b1 - b2, 2)
    )
}

function classifyPixel(r, g, b) {
    // Reference colors (from your measurements)
    const BLUE = { r: 143, g: 170, b: 220 }
    const GREY = { r: 224, g: 224, b: 224 }

    const dBlue = colorDistance(r, g, b, BLUE.r, BLUE.g, BLUE.b)
    const dGrey = colorDistance(r, g, b, GREY.r, GREY.g, GREY.b)

    // Tune tolerances if needed (these are safe defaults)
    if (dBlue < 45) return "outage"
    if (dGrey < 35) return "gray"

    return "on"
}

function statesToSlots(states) {
    const slots = []
    let start = null

    for (let i = 0; i < states.length; i++) {
        if (states[i] !== "on" && start === null) {
            start = i
        }

        if (states[i] === "on" && start !== null) {
            slots.push(
                `${String(start).padStart(2, "0")}:00 - ${String(i).padStart(2, "0")}:00`
            )
            start = null
        }
    }

    // outage until end of day
    if (start !== null) {
        slots.push(
            `${String(start).padStart(2, "0")}:00 - 24:00`
        )
    }

    return slots
}

export default async (req, context) => {
    try {
        const imageURL = await getScheduleImageUrl();
        // Download image
        const res = await fetch(imageURL)
        const buffer = Buffer.from(await res.arrayBuffer())

        const img = await loadImage(buffer)

        const canvas = createCanvas(img.width, img.height)
        const ctx = canvas.getContext("2d")
        ctx.drawImage(img, 0, 0)

        for (let r = 0; r < gridConfig.subqueues.length; r++) {
            const subqueue = gridConfig.subqueues[r]
            let states = []

            for (let c = 0; c < gridConfig.hours; c++) {
                const x = Math.floor(
                    gridConfig.left + c * gridConfig.cellWidth + gridConfig.cellWidth / 2
                )
                const y = Math.floor(
                    gridConfig.top + r * gridConfig.cellHeight + gridConfig.cellHeight / 2
                )

                const pixel = ctx.getImageData(x, y, 1, 1).data
                const state = classifyPixel(pixel[0], pixel[1], pixel[2])
                states.push(state)
            }

            results[subqueue] = statesToSlots(states)
        }

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store" // important for widgets
            },
            body: JSON.stringify({
                date: outagesDate,
                updatedAt: new Date().toISOString(),
                subqueues: results
            })
        }
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message })
        }
    }
}
