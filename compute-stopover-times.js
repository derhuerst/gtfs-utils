'use strict'

const {Transform, pipeline} = require('stream')
const {DateTime} = require('luxon')

const readServicesAndExceptions = require('./read-services-and-exceptions')
const readTrips = require('./read-trips')
const parseTime = require('./parse-time')
const errorsWithRow = require('./lib/errors-with-row')

const isObj = o => 'object' === typeof o && o !== null && !Array.isArray(o)

// todo: stopover.stop_timezone
const computeStopoverTimes = (readFile, filters, timezone) => {
	if ('function' !== typeof readFile) {
		throw new Error('readFile must be a function.')
	}

	if (!isObj(filters)) throw new Error('filters must be an object.')
	filters = {
		trip: () => true,
		stopover: () => true,
		...filters,
	}
	if ('function' !== typeof filters.trip) {
		throw new Error('filters.trip must be a function.')
	}
	if ('function' !== typeof filters.stopover) {
		throw new Error('filters.stopover must be a function.')
	}
	const {
		stopover: stopoverFilter,
	} = filters

	let services, trips

	const onStopover = function (s, _, cb) {
		if (!stopoverFilter(s)) return cb()

		const {serviceId, routeId} = trips[s.trip_id]
		const days = services[serviceId]
		if (!days) return cb()

		const arr = parseTime(s.arrival_time)
		const dep = parseTime(s.departure_time)

		for (let day of days) {
			const d = DateTime.fromMillis(day * 1000, {zone: timezone})
			this.push({
				stop_id: s.stop_id,
				trip_id: s.trip_id,
				service_id: serviceId,
				route_id: routeId,
				sequence: s.stop_sequence,
				start_of_trip: day,
				arrival: d.plus(arr) / 1000 | 0,
				departure: d.plus(dep) / 1000 | 0
			})
		}
		cb()
	}

	const parser = new Transform({
		objectMode: true,
		write: errorsWithRow('stop_times', onStopover),
	})

	Promise.all([
		readServicesAndExceptions(readFile, timezone, filters),
		readTrips(readFile, filters.trip)
	])
	.then(([_services, _trips]) => {
		services = _services
		for (let tripId in _trips) {
			_trips[tripId] = {
				serviceId: _trips[tripId].service_id,
				routeId: _trips[tripId].route_id
			}
		}
		trips = _trips

		pipeline(
			readFile('stop_times'),
			parser,
			() => {}
		)
	})
	.catch((err) => {
		parser.destroy(err)
	})

	return parser
}

module.exports = computeStopoverTimes
