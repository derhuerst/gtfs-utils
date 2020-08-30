'use strict'

const {Transform} = require('stream')
const pump = require('pump')

const readServicesAndExceptions = require('./read-services-and-exceptions')
const readTrips = require('./read-trips')
const parseTime = require('./parse-time')
const errorsWithRow = require('./lib/errors-with-row')
const resolveTime = require('./lib/resolve-time')

const isObj = o => 'object' === typeof o && o !== null && !Array.isArray(o)

const computeStopoverTimes = (readFile, filters, timezone) => {
// todo: respect stopover.stop_timezone & agency.agency_timezone
	if ('function' !== typeof readFile) {
		throw new Error('readFile must be a function.')
	}

	if ('string' !== typeof timezone || !timezone) {
		throw new Error('timezone must be a non-empty string.')
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
			this.push({
				stop_id: s.stop_id,
				trip_id: s.trip_id,
				service_id: serviceId,
				route_id: routeId,
				sequence: s.stop_sequence,
				start_of_trip: day,
				arrival: resolveTime(timezone, day, arr),
				departure: resolveTime(timezone, day, dep),
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

		pump(
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
