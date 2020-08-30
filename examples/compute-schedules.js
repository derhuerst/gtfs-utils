'use strict'

const readCsv = require('../read-csv')
const computeSchedules = require('../compute-schedules')

const readFile = (file) => {
	return readCsv(require.resolve('sample-gtfs-feed/gtfs/' + file + '.txt'))
}

;(async () => {
	const schedules = await computeSchedules(readFile)
	for await (const s of schedules.values()) {
		console.log(s)
	}
})()
.catch(console.error)
