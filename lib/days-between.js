'use strict'

const LRUCache = require('quick-lru')
const {DateTime} = require('luxon')

const parseDate = require('../parse-date')

const isObj = o => 'object' === typeof o && o !== null && !Array.isArray(o)

const noWeekdays = {
	sunday: false,
	monday: false,
	tuesday: false,
	wednesday: false,
	thursday: false,
	friday: false,
	saturday: false
}

const day = 24 * 60 * 60

const weekdayIndexes = [
	null,
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday'
]

const cache = new LRUCache({maxSize: 50})

const computeDaysBetween = (beginning, end, weekdays, timezone) => {
	if (!isObj(weekdays)) throw new Error('weekdays must be an object.')
	weekdays = Object.assign(Object.create(null), noWeekdays, weekdays)
	for (let weekday in weekdays) {
		if ('boolean' !== typeof weekdays[weekday]) {
			throw new Error(`weekdays.${weekday} must be a boolean.`)
		}
	}

	const signature = [
		beginning,
		end,
		weekdays.monday,
		weekdays.tuesday,
		weekdays.wednesday,
		weekdays.thursday,
		weekdays.friday,
		weekdays.saturday,
		weekdays.sunday,
		timezone,
	].join('-')
	if (cache.has(signature)) return cache.get(signature)

	beginning = parseDate(beginning, timezone) * 1000
	beginning = DateTime.fromMillis(beginning, {zone: timezone})
	end = parseDate(end, timezone) * 1000

	const days = []
	const offset = i => beginning.plus({days: i})
	for (let i = 0, t = offset(0); t <= end; i++, t = offset(i)) {
		if (weekdays[weekdayIndexes[t.weekday]]) days.push(t / 1000 | 0)
	}

	cache.set(signature, days)
	return days
}

module.exports = computeDaysBetween
