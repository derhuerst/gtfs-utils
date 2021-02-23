'use strict'

const {DateTime} = require('luxon')
const test = require('tape')
const {createReadStream} = require('fs')
const {readJSON5Sync, readFilesFromFixture} = require('./lib')

const readCsv = require('../read-csv')
const formatDate = require('../format-date')
const daysBetween = require('../lib/days-between')
const resolveTime = require('../lib/resolve-time')
const computeStopovers = require('../compute-stopovers')
const computeSortedConnections = require('../compute-sorted-connections')
const computeServiceBreaks = require('../compute-service-breaks')
const {extendedToBasic} = require('../route-types')

const testWithFixtures = (fn, fixtures, prefix = '') => {
	fixtures.forEach((f) => {
		const title = [prefix, f.title].filter(s => !!s).join(' – ')
		const args = f.args.map(a => a[1]) // select values
		const testFn = f.fails
			? (t) => {
				t.plan(1)
				t.throws(() => fn(...args))
			}
			: (t) => {
				t.plan(1)
				t.deepEqual(fn(...args), f.result)
			}
		test(title, testFn)
	})
}

testWithFixtures(
	require('../parse-date'),
	readJSON5Sync(require.resolve('./fixtures/parse-date.json5')),
	'parse-date',
)

testWithFixtures(
	require('../parse-time'),
	readJSON5Sync(require.resolve('./fixtures/parse-time.json5')),
	'parse-time',
)

testWithFixtures(
	require('../lib/resolve-time'),
	readJSON5Sync(require.resolve('./fixtures/resolve-time.json5')),
	'resolve-time',
)

// const data = {
// 	services: require('sample-gtfs-feed/json/calendar.json'),
// 	exceptions: require('sample-gtfs-feed/json/calendar_dates.json'),
// 	trips: require('sample-gtfs-feed/json/trips.json'),
// 	stopovers: require('sample-gtfs-feed/json/stop_times.json')
// }
const readFile = (file) => {
	return readCsv(require.resolve('sample-gtfs-feed/gtfs/' + file + '.txt'))
}

const utc = 'Etc/UTC'
const berlin = 'Europe/Berlin'

test('read-csv: accept a readable stream as input', (t) => {
	const readable = createReadStream(require.resolve('sample-gtfs-feed/gtfs/stops.txt'))
	const src = readCsv(readable)

	src.once('data', (stop) => {
		t.ok(stop)
		t.ok(stop.stop_id)
		src.destroy()
		t.end()
	})
})

test('format-date', (t) => {
	t.plan(3)
	t.equal(formatDate(1551571200, utc), '20190303')
	t.equal(formatDate(1551567600, berlin), '20190303')
	t.equal(formatDate(1551546000, 'Asia/Bangkok'), '20190303')
})

test('lib/days-between', (t) => {
	const march3rd = 1551567600 // Europe/Berlin
	const march4th = 1551654000 // Europe/Berlin
	const march5th = 1551740400 // Europe/Berlin
	const allWeekdays = {
		monday: true,
		tuesday: true,
		wednesday: true,
		thursday: true,
		friday: true,
		saturday: true,
		sunday: true
	}

	t.deepEqual(daysBetween('20190313', '20190303', allWeekdays, berlin), [])
	t.deepEqual(daysBetween('20190303', '20190303', allWeekdays, berlin), [
		march3rd
	])
	t.deepEqual(daysBetween('20190303', '20190305', allWeekdays, berlin), [
		march3rd,
		march4th,
		march5th
	])
	t.equal(daysBetween('20190303', '20190313', allWeekdays, berlin).length, 11)

	const many = daysBetween('20190303', '20190703', allWeekdays, berlin)
	t.ok(Array.isArray(many))
	for (let ts of many) {
		const d = DateTime.fromMillis(ts * 1000, {zone: berlin})
		if (d.hour !== 0) console.error(ts)
		t.equal(d.hour, 0)
		t.equal(d.minute, 0)
		t.equal(d.second, 0)
		t.equal(d.millisecond, 0)
	}

	t.end()
})

test('lib/resolve-time', (t) => {
	const r = resolveTime
	const _ = iso => Date.parse(iso) / 1000
	const tzA = 'Europe/Berlin'
	const t0A = Date.parse('2021-02-02T00:00+01:00') / 1000
	const tzB = 'Asia/Bangkok'
	const t0B = Date.parse('2021-02-02T00:00+07:00') / 1000
	const time1 = 3 * 3600 + 2 * 60 + 1 // 03:02:01
	const time2 = 26 * 3600 // 26:00

	t.equal(r(tzA, t0A, time1), _('2021-02-02T03:02:01+01:00'))
	t.equal(r(tzA, t0A, time2), _('2021-02-03T02:00+01:00'))
	t.equal(r(tzB, t0A, time1), _('2021-02-02T03:02:01+07:00'))
	t.equal(r(tzB, t0A, time2), _('2021-02-03T02:00+07:00'))
	t.equal(r(tzB, t0B, time1), _('2021-02-02T03:02:01+07:00'))
	t.equal(r(tzB, t0B, time2), _('2021-02-03T02:00+07:00'))
	t.end()
})

require('./read-stop-times')

const stopoversFixtures = readJSON5Sync(require.resolve('./fixtures/stopovers.json5'))
test('compute-stopovers: works', async (t) => {
	const stopovers = computeStopovers(readFile, 'Europe/Berlin', {
		trip: t => t.trip_id === 'b-downtown-on-working-days',
	})
	const res = []
	for await (const s of stopovers) res.push(s)

	t.deepEqual(res, stopoversFixtures)
})

test('compute-stopovers: handles DST switch properly', async (t) => {
	const readFile = readFilesFromFixture('daylight-saving-time')
	const stopovers = computeStopovers(readFile, 'Europe/Berlin')

	const res = []
	for await (const s of stopovers) res.push(s)
	t.deepEqual(res, [{
		stop_id: '1',
		trip_id: 'A1',
		service_id: 'sA',
		route_id: 'A',
		start_of_trip: 1572127200, // 2019-10-27T00:00:00+02:00
		arrival: 1572137940, // 2019-10-27T02:59:00+02:00
		departure: 1572138060, // 2019-10-27T02:01:00+01:00
	}, {
		stop_id: '2',
		trip_id: 'A1',
		service_id: 'sA',
		route_id: 'A',
		start_of_trip: 1572127200, // 2019-10-27T00:00:00+02:00
		arrival: 1572141540, // 2019-10-27T02:59:00+01:00
		departure: 1572141660, // 2019-10-27T03:01:00+01:00
	}, {
		stop_id: '2',
		trip_id: 'B1',
		service_id: 'sB',
		route_id: 'B',
		start_of_trip: 1553986800, // 2019-03-31T00:00:00+01:00
		arrival: 1553990340, // 2019-03-31T00:59:00+01:00
		departure: 1553990460, // 2019-03-31T01:01:00+01:00
	}, {
		stop_id: '1',
		trip_id: 'B1',
		service_id: 'sB',
		route_id: 'B',
		start_of_trip: 1553986800, // 2019-03-31T00:00:00+01:00
		arrival: 1553993940, // 2019-03-31T01:59:00+01:00
		departure: 1553994060,// 2019-03-31T03:01:00+02:00
	}])
})

test('compute-sorted-connections', async (t) => {
	const sortedCons = await computeSortedConnections(readFile, 'Europe/Berlin')

	const from = 1552324800 // 2019-03-11T18:20:00+01:00
	const to = 1552377500 // 2019-03-12T08:58:20+01:00
	const fromI = sortedCons.findIndex(c => c.departure >= from)
	const toI = sortedCons.findIndex(c => c.departure > to)
	const connections = sortedCons.slice(fromI, toI)

	t.deepEqual(connections, [{
		tripId: 'b-outbound-on-working-days',
		serviceId: 'on-working-days',
		routeId: 'B',
		fromStop: 'lake',
		departure: 1552324920,
		toStop: 'airport',
		arrival: 1552325400,
		headwayBased: false
	}, {
		tripId: 'b-downtown-on-working-days',
		serviceId: 'on-working-days',
		routeId: 'B',
		fromStop: 'airport',
		departure: 1552377360,
		toStop: 'lake',
		arrival: 1552377720,
		headwayBased: false
	}])
})

test('compute-service-breaks', async (t) => {
	const connections = await computeSortedConnections(readFile, 'Europe/Berlin')
	const allBreaks = computeServiceBreaks(connections, {
		minLength: 30 * 60, // 30m
	})

	const breaks = []
	const from = 1557309600 // 2019-05-08T12:00:00+02:00
	const to = 1557493200 // 2019-05-10T15:00:00+02:00
	for await (const br of allBreaks) {
		if (br.start < from || br.start > to) continue
		if (br.fromStop !== 'airport' || br.toStop !== 'lake') continue
		breaks.push(br)
	}

	t.deepEqual(breaks, [{
		fromStop: 'airport',
		toStop: 'lake',
		start: Date.parse('2019-05-08T13:14:00+02:00') / 1000,
		end: Date.parse('2019-05-09T08:56:00+02:00') / 1000,
		duration: 70920,
		routeId: 'B',
		serviceId: 'on-working-days',
	}, {
		fromStop: 'airport',
		toStop: 'lake',
		start: Date.parse('2019-05-09T08:56:00+02:00') / 1000,
		end: Date.parse('2019-05-09T13:14:00+02:00') / 1000,
		duration: 15480,
		routeId: 'B',
		serviceId: 'on-working-days',
	}, {
		fromStop: 'airport',
		toStop: 'lake',
		start: Date.parse('2019-05-09T13:14:00+02:00') / 1000,
		end: Date.parse('2019-05-10T08:56:00+02:00') / 1000,
		duration: 70920,
		routeId: 'B',
		serviceId: 'on-working-days',
	}, {
		fromStop: 'airport',
		toStop: 'lake',
		start: Date.parse('2019-05-10T08:56:00+02:00') / 1000,
		end: Date.parse('2019-05-10T13:14:00+02:00') / 1000,
		duration: 15480,
		routeId: 'B',
		serviceId: 'on-working-days',
	}, {
		fromStop: 'airport',
		toStop: 'lake',
		start: Date.parse('2019-05-10T13:14:00+02:00') / 1000,
		end: Date.parse('2019-05-11T08:56:00+02:00') / 1000,
		duration: 70920,
		routeId: 'B',
		serviceId: 'on-working-days',
	}])
})

test('extendedToBasic', (t) => {
	t.plan(2)
	t.equal(extendedToBasic(110), 0)
	t.equal(extendedToBasic(706), 3)
})
