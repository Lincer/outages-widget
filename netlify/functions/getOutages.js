import fetch from "node-fetch"
import { createCanvas, loadImage } from "canvas"

const PAGE_URL = "https://hoe.com.ua/page/pogodinni-vidkljuchennja"

// image grid config
const gridConfig = {
    left: 207,
    top: 255,
    cellWidth: 57.3,
    cellHeight: 44,
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

async function getScheduleData() {
    const res = await fetch(PAGE_URL)
    const html = await res.text()

    const currentDate = getCurrentDateString(todayUtc());

    const textSchedule = parseTextSchedule(html)
    if (textSchedule) {
        return { textSchedule }
    }

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

const ukrainianMonths = {
    "січня": 1, "лютого": 2, "березня": 3, "квітня": 4,
    "травня": 5, "червня": 6, "липня": 7, "серпня": 8,
    "вересня": 9, "жовтня": 10, "листопада": 11, "грудня": 12
}

function parseTextSchedule(html) {
    // The page can contain older or repeated schedule sections after the latest post.
    // Parse only the first post, which contains the current published schedule.
    let scheduleHtml = html
    const postStart = scheduleHtml.search(/<div\b[^>]*class=["'][^"']*\bpost\b[^"']*["'][^>]*>/i)
    if (postStart !== -1) scheduleHtml = scheduleHtml.slice(postStart)
    const sectionEnd = scheduleHtml.search(/<hr\b/i)
    if (sectionEnd !== -1) scheduleHtml = scheduleHtml.slice(0, sectionEnd)

    // Parse visible HTML text so tags around subqueue entries do not affect matching.
    const text = scheduleHtml
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p\s*>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
        .replace(/&ndash;|&#8211;|&#x2013;/gi, "–")
        .replace(/&mdash;|&#8212;|&#x2014;/gi, "—")
        .replace(/&amp;/gi, "&")
        .replace(/[\t\r ]+/g, " ");

    const dateMatch = text.match(/(?:^|\s)(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)(?=\s|[,.:;!?)]|$)/i)
    if (!dateMatch) return null

    const day = Number(dateMatch[1])
    const month = ukrainianMonths[dateMatch[2].toLowerCase()]
    const date = dateForDayMonth(day, month)
    if (!date || date < todayUtc()) return null

    const results = noOutagesResults()
    const matchedQueues = new Set()
    for (const line of text.split("\n")) {
        const match = line.match(/Підчерга\s+(\d+\.\d+)\s*[–—-]\s*(.*)/i)
        if (!match) continue
        const subqueue = match[1]
        if (!Object.prototype.hasOwnProperty.call(results, subqueue)) continue
        if (matchedQueues.has(subqueue)) return null

        const windowPattern = /\b([01]?\d|2[0-4]):([0-5]\d)\s*[-–—]\s*([01]?\d|2[0-4]):([0-5]\d)\b/g
        const windows = []
        let windowMatch
        while ((windowMatch = windowPattern.exec(match[2])) !== null) {
            const startHour = Number(windowMatch[1])
            const startMinute = Number(windowMatch[2])
            const endHour = Number(windowMatch[3])
            const endMinute = Number(windowMatch[4])
            if (startHour > 23 || endHour > 24 || (endHour === 24 && endMinute !== 0)) continue
            const start = startHour * 60 + startMinute
            const end = endHour * 60 + endMinute
            if (end <= start) continue
            windows.push(`${String(startHour).padStart(2, "0")}:${String(startMinute).padStart(2, "0")} - ${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`)
        }
        results[subqueue] = windows
        matchedQueues.add(subqueue)
    }

    // A partial/malformed text block must not replace a valid image schedule or empty fallback.
    if (matchedQueues.size !== gridConfig.subqueues.length) return null
    return { date: `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}`, subqueues: results }
}

function dateForDayMonth(day, month) {
    if (!Number.isInteger(day) || day < 1 || day > 31 || !month) return null
    const today = todayUtc()
    let year = today.getUTCFullYear()
    let date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return null
    // The schedule is for the nearest occurrence of this day/month; handle year rollover.
    if (date < today) date = new Date(Date.UTC(year + 1, month - 1, day))
    return date
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
    const m = alt.match(/ГПВ\s+(\d{2})(\d{2})(\d{4})/)
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
        const schedule = await getScheduleData();

        if (schedule.textSchedule) {
            return new Response(JSON.stringify(schedule.textSchedule), {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-store"
                }
            })
        }

        const {imageURL, date} = schedule

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
