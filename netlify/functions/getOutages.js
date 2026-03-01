import fetch from "node-fetch"
import { createCanvas, loadImage } from "canvas"

const PAGE_URL = "https://hoe.com.ua/page/pogodinni-vidkljuchennja"

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

async function getScheduleImageData() {
    const res = await fetch(PAGE_URL)
    const html = await res.text()

    const currentDate = getCurrentDateString(todayUtc());

    // find first <img> with alt containing "ГПВ"
    const imgMatch = html.match(
        /<img[^>]+alt=["']([^"']*ГПВ[^"']*)["'][^>]+src=["']([^"']+)["']/i
    )

    // if no image found, serve the current date
    if (!imgMatch) {
        return { imageUrl: null, date: currentDate }
    }

    const alt = imgMatch[1]
    const src = imgMatch[2]
    const parsedAltDate = parseAltDate(alt)

    // if the alt date is missing or in the past, fall back to the current date and skip the image
    if (!parsedAltDate || parsedAltDate.date < todayUtc()) {
        return { imageUrl: null, date: currentDate }
    }

    return { imageURL: `https://hoe.com.ua${src}`, date: parsedAltDate.display }
}

function todayUtc() {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function getCurrentDateString(date) {
    const day = String(date.getUTCDate()).padStart(2, "0")
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    return `${day}.${month}`
}

function parseAltDate(alt) {
    const m = alt.match(/(\d{2})\.(\d{2})/)
    if (!m) return null

    const day = Number(m[1])
    const month = Number(m[2]) - 1 // zero-based month
    const year = todayUtc().getUTCFullYear()

    const date = new Date(Date.UTC(year, month, day))
    if (Number.isNaN(date.getTime())) return null

    return { display: `${m[1]}.${m[2]}`, date }
}

function noOutagesResults() {
    const subqueues = {}

    for (const subqueue of gridConfig.subqueues) {
        subqueues[subqueue] = []
    }

    return subqueues
}

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
    if (states.every(state => state === "on")) {
        return []
    }

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

    // outage until the end of the day
    if (start !== null) {
        slots.push(
            `${String(start).padStart(2, "0")}:00 - 24:00`
        )
    }

    return slots
}

export default async () => {
    const results = {}

    try {
        const {imageURL, date} = await getScheduleImageData();

        // no image was found on the page, serve current date and empty results
        if (!imageURL) {
            const data = {
                date,
                subqueues: noOutagesResults()
            }

            return new Response(JSON.stringify(data), {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-store"
                }
            })
        }

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

        const data = {
            date,
            subqueues: results
        }

        return new Response(JSON.stringify(data), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store"
            }
        })
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500 }
        )
    }
}
