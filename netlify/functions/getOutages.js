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

    const today = getKyivDateString();
    const currentDate = getCurrentDateString(today);

    const textSchedule = parseTextSchedule(html, today)
    let scheduleDate
    let imageURL

    if (textSchedule) {
        scheduleDate = textSchedule.scheduleDate
        delete textSchedule.scheduleDate
    } else {
        // find first <img> with alt containing "ГПВ"
        const imgMatch = html.match(
            /<img[^>]+alt=["']([^"']*ГПВ[^"']*)["'][^>]+src=["']([^"']+)["']/i
        )
        if (imgMatch) {
            const parsedAltDate = parseAltDate(imgMatch[1])
            scheduleDate = parsedAltDate?.date
            imageURL = `https://hoe.com.ua${imgMatch[2]}`
        }
    }

    // Apply the same freshness check to text and image schedules.
    if (!scheduleDate || scheduleDate < today) {
        return { imageUrl: null, date: currentDate }
    }

    if (textSchedule) return { textSchedule }

    return { imageURL, date: getCurrentDateString(scheduleDate) }
}

const ukrainianMonths = {
    "січня": 1, "лютого": 2, "березня": 3, "квітня": 4,
    "травня": 5, "червня": 6, "липня": 7, "серпня": 8,
    "вересня": 9, "жовтня": 10, "листопада": 11, "грудня": 12
}

function parseTextSchedule(html, today = getKyivDateString()) {
    // Keep each <hr>-separated schedule independent; updates for one date must
    // not be combined with the date or queues from another schedule.
    let scheduleHtml = html
    const postStart = scheduleHtml.search(/<div\b[^>]*class=["'][^"']*\bpost\b[^"']*["'][^>]*>/i)
    if (postStart !== -1) scheduleHtml = scheduleHtml.slice(postStart)

    const tomorrow = addDays(today, 1)
    const candidates = []
    for (const [sectionIndex, sectionHtml] of scheduleHtml.split(/<hr\b[^>]*>/i).entries()) {
        const schedule = parseTextScheduleSection(sectionHtml)
        if (!schedule) continue
        if (schedule.scheduleDate === today) candidates.push({ schedule, sectionIndex, priority: 0 })
        else if (schedule.scheduleDate === tomorrow) candidates.push({ schedule, sectionIndex, priority: 1 })
    }

    // The page lists newest sections first. Prefer today's newest schedule,
    // falling back to tomorrow's newest schedule if today's is absent.
    candidates.sort((a, b) => a.priority - b.priority || a.sectionIndex - b.sectionIndex)
    return candidates[0]?.schedule || null
}

function parseTextScheduleSection(sectionHtml) {
    const text = htmlToVisibleText(sectionHtml)
    const parsedDate = parseTextDate(text)
    if (!parsedDate) return null

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

    // Require queue entries so unrelated page text is not treated as a schedule.
    if (matchedQueues.size === 0) return null
    return {
        date: getCurrentDateString(parsedDate.date),
        scheduleDate: parsedDate.date,
        subqueues: results
    }
}

function htmlToVisibleText(html) {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .replace(/<\/p\s*>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
        .replace(/&ndash;|&#8211;|&#x2013;/gi, "–")
        .replace(/&mdash;|&#8212;|&#x2014;/gi, "—")
        .replace(/&amp;/gi, "&")
        .replace(/[\t\r ]+/g, " ")
}

function parseTextDate(text) {
    const numericDateMatch = text.match(/(?:^|\s)(\d{1,2})\.(\d{1,2})\.(\d{4})(?=\s|[,;!?)]|$)/)
    if (numericDateMatch) {
        const day = Number(numericDateMatch[1])
        const month = Number(numericDateMatch[2])
        const year = Number(numericDateMatch[3])
        const date = new Date(Date.UTC(year, month - 1, day))
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
        return { date: date.toISOString().slice(0, 10) }
    }

    const monthNameDateMatch = text.match(/(?:^|\s)(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)(?=\s|[,.:;!?)]|$)/i)
    if (!monthNameDateMatch) return null

    const day = Number(monthNameDateMatch[1])
    const month = ukrainianMonths[monthNameDateMatch[2].toLowerCase()]
    const date = dateForDayMonth(day, month)
    return date ? { date } : null
}

function dateForDayMonth(day, month) {
    if (!Number.isInteger(day) || day < 1 || day > 31 || !month) return null
    const today = getKyivDateString()
    const currentYear = Number(today.slice(0, 4))
    const todayUtc = Date.parse(`${today}T00:00:00Z`)
    const candidates = [currentYear - 1, currentYear, currentYear + 1]
        .map(year => new Date(Date.UTC(year, month - 1, day)))
        .filter(date => date.getUTCDate() === day && date.getUTCMonth() === month - 1)
    candidates.sort((a, b) => Math.abs(a.getTime() - todayUtc) - Math.abs(b.getTime() - todayUtc))
    return candidates[0]?.toISOString().slice(0, 10) || null
}

function getKyivDateString(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Kyiv",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(now)
    const part = type => parts.find(item => item.type === type).value
    return `${part("year")}-${part("month")}-${part("day")}`
}

function addDays(dateString, days) {
    const date = new Date(`${dateString}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
}

function getCurrentDateString(dateString) {
    const [, , month, day] = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    return `${day}.${month}`
}

function parseAltDate(alt) {
    const m = alt.match(/ГПВ\s+(\d{2})(\d{2})(\d{4})/)
    if (!m) return null

    const day = Number(m[1])
    const month = Number(m[2])
    const year = Number(m[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null

    return { display: `${m[1]}.${m[2]}`, date: date.toISOString().slice(0, 10) }
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
