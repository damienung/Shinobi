//
// Shinobi
// Copyright (C) 2016-2025 Moe Alam, moeiscool
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// # Donate
//
// If you like what I am doing here and want me to continue please consider donating :)
// PayPal : paypal@m03.a
//
process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err)
})

let express = require('express')
let app = express()
let server = require('./modules/server.js').getServer(app)
let io = require('socket.io')(server)

let fs = require('fs')
let os = require('os')
let path = require('path')
let moment = require('moment')
let request = require('request')

let exec = require('child_process').exec
let spawn = require('child_process').spawn
let crypto = require('crypto')
let webdav = require('webdav')
let connectionTester = require('connection-tester')
let events = require('events')
let df = require('node-df')
let Cam = require('onvif').Cam
let config = require('./conf.json')
let videofeed = require('./modules/videofeed.js')

let s = { child_help: false, platform: os.platform(), s: JSON.stringify }
let sql = require('./modules/database.js').getConnection()

videofeed.killOpenVideoFeeds()

s.md5 = (x) => { return crypto.createHash('md5').update(x).digest('hex') }

s.emitToRoom = (data, room) => {
  io.to(room).emit('f', data)
}

// load camera controller vars
s.nameToTime = (x) => {
  x = x.split('.')[0].split('T')
  x[1] = x[1].replace(/-/g, ':')
  x = x.join(' ')
  return x
}
s.ratio = (width, height, ratio) => { ratio = width / height; return (Math.abs(ratio - 4 / 3) < Math.abs(ratio - 16 / 9)) ? '4:3' : '16:9' }
s.gid = (x) => {
  if (!x) { x = 10 }
  let t = ''
  let p = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < x; i++) { t += p.charAt(Math.floor(Math.random() * p.length)) }
  return t
}
s.moment = (e, x) => {
  if (!e) { e = new Date() }
  if (!x) { x = 'YYYY-MM-DDTHH-mm-ss' }
  e = moment(e)
  if (config.utcOffset) { e = e.utcOffset(config.utcOffset) }
  return e.format(x)
}
s.moment_noOffset = (e, x) => {
  if (!e) { e = new Date() }
  if (!x) { x = 'YYYY-MM-DDTHH-mm-ss' }
  return moment(e).format(x)
}
s.ipRange = (startIp, endIp) => {
  let startLong = s.toLong(startIp)
  let endLong = s.toLong(endIp)
  if (startLong > endLong) {
    let tmp = startLong
    startLong = endLong
    endLong = tmp
  }
  let rangeArray = []
  let i
  for (i = startLong; i <= endLong; i++) {
    rangeArray.push(s.fromLong(i))
  }
  return rangeArray
}
s.portRange = (lowEnd, highEnd) => {
  let list = []
  for (let i = lowEnd; i <= highEnd; i++) {
    list.push(i)
  }
  return list
}
// toLong taken from NPM package 'ip'
s.toLong = (ip) => {
  let ipl = 0
  ip.split('.').forEach((octet) => {
    ipl <<= 8
    ipl += parseInt(octet)
  })
  return (ipl >>> 0)
}

// fromLong taken from NPM package 'ip'
s.fromLong = (ipl) => {
  return ((ipl >>> 24) + '.' +
        (ipl >> 16 & 255) + '.' +
        (ipl >> 8 & 255) + '.' +
        (ipl & 255))
}
s.kill = (x, e, p) => {
  if (s.group[e.ke] && s.group[e.ke].mon[e.id]) {
    if (s.group[e.ke].mon[e.id].spawn) {
      try {
        s.group[e.ke].mon[e.id].spawn.removeListener('end', s.group[e.ke].mon[e.id].spawn_exit)
        s.group[e.ke].mon[e.id].spawn.removeListener('exit', s.group[e.ke].mon[e.id].spawn_exit)
        delete (s.group[e.ke].mon[e.id].spawn_exit)
      } catch (er) {}
    }
    clearTimeout(s.group[e.ke].mon[e.id].checker)
    clearTimeout(s.group[e.ke].mon[e.id].watchdog_stop)
    if (e && s.group[e.ke].mon[e.id].record) {
      clearTimeout(s.group[e.ke].mon[e.id].record.capturing)
            //            if(s.group[e.ke].mon[e.id].record.request){s.group[e.ke].mon[e.id].record.request.abort();delete(s.group[e.ke].mon[e.id].record.request);}
    }
    if (s.group[e.ke].mon[e.id].child_node) {

    } else {
      if (!x || x === 1) { return }
      p = x.pid
      x.stdin.pause()
      setTimeout(() => {
        x.kill('SIGTERM')
        setTimeout(() => { exec('kill -9 ' + p) }, 1000)
      }, 1000)
    }
  }
}
s.log = (e, x) => {
  if (!x || !e.mid) { return }
  if (e.details && e.details.sqllog === 1) {
    sql.query('INSERT INTO Logs (ke,mid,info) VALUES (?,?,?)', [e.ke, e.mid, s.s(x)])
  }
  s.emitToRoom({ f: 'log', ke: e.ke, mid: e.mid, log: x, time: moment() }, 'GRP_' + e.ke)
    //    console.log('s.log : ',{f:'log',ke:e.ke,mid:e.mid,log:x,time:moment()},'GRP_'+e.ke)
}
// directories
s.group = {}
if (!config.defaultMjpeg) { config.defaultMjpeg = path.join(__dirname, '/web/libs/img/bg.jpg') }
// default stream folder check
if (!config.streamDir) {
  config.streamDir = '/dev/shm'
  if (!fs.existsSync(config.streamDir)) {
    config.streamDir = path.join(__dirname, '/streams/')
  } else {
    config.streamDir += '/streams/'
  }
}
if (!config.videosDir) { config.videosDir = path.join(__dirname, '/videos/') }
s.dir = { videos: config.videosDir, streams: config.streamDir }
// streams dir
if (!fs.existsSync(s.dir.streams)) {
  fs.mkdirSync(s.dir.streams)
}
// videos dir
if (!fs.existsSync(s.dir.videos)) {
  fs.mkdirSync(s.dir.videos)
}
/// /Camera Controller
s.init = (x, e) => {
  if (!e) { e = {} }
  switch (x) {
    case 0: // camera
      if (!s.group[e.ke]) { s.group[e.ke] = {} }
      if (!s.group[e.ke].mon) { s.group[e.ke].mon = {} }
      if (!s.group[e.ke].users) { s.group[e.ke].users = {} }
      if (!s.group[e.ke].mon[e.mid]) { s.group[e.ke].mon[e.mid] = {} }
      if (!s.group[e.ke].mon[e.mid].watch) { s.group[e.ke].mon[e.mid].watch = {} }
      if (e.type === 'record') { e.record = 1 } else { e.record = 0 }
      if (!s.group[e.ke].mon[e.mid].record) { s.group[e.ke].mon[e.mid].record = { yes: e.record } }
      if (!s.group[e.ke].mon[e.mid].started) { s.group[e.ke].mon[e.mid].started = 0 }
      if (s.group[e.ke].mon[e.mid].delete) { clearTimeout(s.group[e.ke].mon[e.mid].delete) }
      s.init('apps', e)
      break
    case 'apps':
      if (!s.group[e.ke].init) {
        s.group[e.ke].init = {}
        sql.query('SELECT * FROM Users WHERE ke=? AND details NOT LIKE ?', [e.ke, '%"sub"%'], (ar, r) => {
          if (r && r[0]) {
            r = r[0]
            ar = JSON.parse(r.details)
            if (!ar.sub) {
                            // owncloud/webdav
              if (ar.webdav_user &&
                                ar.webdav_user !== '' &&
                                ar.webdav_pass &&
                                ar.webdav_pass !== '' &&
                                ar.webdav_url &&
                                ar.webdav_url !== ''
                            ) {
                if (!ar.webdav_dir || ar.webdav_dir === '') {
                  ar.webdav_dir = '/'
                  if (ar.webdav_dir.slice(-1) !== '/') { ar.webdav_dir += '/' }
                }
                s.group[e.ke].webdav = webdav(
                                    ar.webdav_url,
                                    ar.webdav_user,
                                    ar.webdav_pass
                                )
              }
              s.group[e.ke].init = ar
            }
          }
        })
      }
      break
    case 'clean':
      x = { keys: Object.keys(e), ar: {} }
      x.keys.forEach((v) => {
        if (v !== 'last_frame' && v !== 'record' && v !== 'spawn' && v !== 'running' && (v !== 'time' && typeof e[v] !== 'function')) { x.ar[v] = e[v] }
      })
      return x.ar
    case 'url':
      e.authd = ''
      if (e.details.muser && e.details.muser !== '' && e.details.mpass && e.details.mpass !== '' && e.host.indexOf('@') === -1) {
        e.authd = e.details.muser + ':' + e.details.mpass + '@'
      }
      if (e.port === 80) { e.porty = '' } else { e.porty = ':' + e.port }
      e.url = e.protocol + '://' + e.authd + e.host + e.porty + e.path
      return e.url
    case 'url_no_path':
      e.authd = ''
      if (!e.details.muser) { e.details.muser = '' }
      if (!e.details.mpass) { e.details.mpass = '' }
      if (e.details.muser !== '' && e.host.indexOf('@') === -1) {
        e.authd = e.details.muser + ':' + e.details.mpass + '@'
      }
      if (e.port === 80) { e.porty = '' } else { e.porty = ':' + e.port }
      e.url = e.protocol + '://' + e.authd + e.host + e.porty
      return e.url
  }
  if (typeof e.callback === 'function') { setTimeout(() => { e.callback() }, 500) }
}

s.video = (x, e) => {
  if (!e) { e = {} }
  if (e.mid && !e.id) { e.id = e.mid }
  switch (x) {
    case 'delete':
      e.dir = s.dir.videos + e.ke + '/' + e.id + '/'
      if (!e.status) { e.status = 0 }
      e.save = [e.id, e.ke, s.nameToTime(e.filename), e.status]
      sql.query('DELETE FROM Videos WHERE `mid`=? AND `ke`=? AND `time`=? AND `status`=?', e.save, (err, r) => {
        s.emitToRoom({ f: 'video_delete', filename: e.filename + '.' + e.ext, mid: e.mid, ke: e.ke, time: s.nameToTime(e.filename), end: s.moment(new Date(), 'YYYY-MM-DD HH:mm:ss') }, 'GRP_' + e.ke)
        s.file('delete', e.dir + e.filename + '.' + e.ext)
      })
      break
    case 'open':
      e.save = [e.id, e.ke, s.nameToTime(e.filename), e.ext]
      if (!e.status) { e.save.push(0) } else { e.save.push(e.status) }
      sql.query('INSERT INTO Videos (mid,ke,time,ext,status) VALUES (?,?,?,?,?)', e.save)
      s.emitToRoom({
        f: 'video_build_start',
        filename: e.filename + '.' + e.ext,
        mid: e.id,
        ke: e.ke,
        time: s.nameToTime(e.filename),
        end: s.moment(new Date(), 'YYYY-MM-DD HH:mm:ss')
      }, 'GRP_' + e.ke)
      break
    case 'close':
      e.dir = s.dir.videos + e.ke + '/' + e.id + '/'
      if (s.group[e.ke] && s.group[e.ke].mon[e.id]) {
        if (s.group[e.ke].mon[e.id].open && !e.filename) {
          e.filename = s.group[e.ke].mon[e.id].open
          e.ext = s.group[e.ke].mon[e.id].open_ext
        }
        if (s.group[e.ke].mon[e.id].child_node) {
          
        } else {
          if (fs.existsSync(e.dir + e.filename + '.' + e.ext)) {
            e.filesize = fs.statSync(e.dir + e.filename + '.' + e.ext)['size']
            if ((e.filesize / 100000).toFixed(2) > 0.25) {
              e.save = [e.filesize, e.frames, 1, e.id, e.ke, s.nameToTime(e.filename)]
              if (!e.status) { e.save.push(0) } else { e.save.push(e.status) }
              sql.query('UPDATE Videos SET `size`=?,`frames`=?,`status`=? WHERE `mid`=? AND `ke`=? AND `time`=? AND `status`=?', e.save)
              s.emitToRoom({
                f: 'video_build_success',
                filename: e.filename + '.' + e.ext,
                mid: e.id,
                ke: e.ke,
                time: s.nameToTime(e.filename),
                size: e.filesize,
                end: s.moment(new Date(), 'YYYY-MM-DD HH:mm:ss')
              }, 'GRP_' + e.ke)

                            // cloud auto savers
                            // webdav
              if (s.group[e.ke].webdav && s.group[e.ke].init.webdav_save === '1') {
                fs.readFile(e.dir + e.filename + '.' + e.ext, (err, data) => {
                  s.group[e.ke].webdav.putFileContents(s.group[e.ke].init.webdav_dir + e.ke + '/' + e.mid + '/' + e.filename + '.' + e.ext, 'binary', data)
                                        .catch((err) => {
                                          s.log(e, { type: 'Webdav Error', msg: { msg: 'Cannot save. Did you make the folders <b>/' + e.ke + '/' + e.id + '</b> inside your chosen save directory?', info: err }, ffmpeg: s.group[e.ke].mon[e.id].ffmpeg })
                                          console.error(err)
                                        })
                })
              }
            } else {
              s.video('delete', e)
              s.log(e, { type: 'File Corrupt', msg: { ffmpeg: s.group[e.ke].mon[e.mid].ffmpeg, filesize: (e.filesize / 100000).toFixed(2) } })
            }
          } else {
            s.video('delete', e)
            s.log(e, { type: 'File Not Exist', msg: 'Cannot save non existant file. Something went wrong.', ffmpeg: s.group[e.ke].mon[e.id].ffmpeg })
          }
        }
      }
      delete (s.group[e.ke].mon[e.id].open)
            //            s.init('sync',e)
      break
  }
}
s.ffmpeg = (e, x) => {
  if (!x) { x = { tmp: '' } }
  x.watch = ''
  x.cust_input = ''
  x.cust_detect = ' '
    // analyze duration
  if (e.details.aduration && e.details.aduration !== '') { x.cust_input += ' -analyzeduration ' + e.details.aduration }
    // segmenting
  x.segment = ' -f segment -segment_atclocktime 1 -reset_timestamps 1 -strftime 1 -segment_list pipe:2 -segment_time ' + (60 * e.cutoff) + ' '
  if (e.details.dqf === '1') {
    x.segment += '"' + e.dir + '%Y-%m-%dT%H-%M-%S.' + e.ext + '"'
  } else {
    x.segment += e.dir + '%Y-%m-%dT%H-%M-%S.' + e.ext
  }
    // check protocol
  switch (e.protocol) {
    case 'rtsp':
      if (e.details.rtsp_transport && e.details.rtsp_transport !== '' && e.details.rtsp_transport !== 'no') { x.cust_input += ' -rtsp_transport ' + e.details.rtsp_transport }
      break
  }
    // resolution
  switch (s.ratio(e.width, e.height)) {
    case '16:9':
      x.ratio = '640x360'
      break
    default:
      x.ratio = '640x480'
      break
  }
  if (e.details.stream_scale_x && e.details.stream_scale_x !== '' && e.details.stream_scale_y && e.details.stream_scale_y !== '') {
    x.ratio = e.details.stream_scale_x + 'x' + e.details.stream_scale_y
  }

    // timestamp options
  if (e.details.timestamp && e.details.timestamp === '1') {
        // font
    if (e.details.timestamp_font && e.details.timestamp_font !== '') { x.time_font = e.details.timestamp_font } else { x.time_font = '/usr/share/fonts/truetype/freefont/FreeSans.ttf' }
        // position x
    if (e.details.timestamp_x && e.details.timestamp_x !== '') { x.timex = e.details.timestamp_x } else { x.timex = '(w-tw)/2' }
        // position y
    if (e.details.timestamp_y && e.details.timestamp_y !== '') { x.timey = e.details.timestamp_y } else { x.timey = '0' }
        // text color
    if (e.details.timestamp_color && e.details.timestamp_color !== '') { x.time_color = e.details.timestamp_color } else { x.time_color = 'white' }
        // box color
    if (e.details.timestamp_box_color && e.details.timestamp_box_color !== '') { x.time_box_color = e.details.timestamp_box_color } else { x.time_box_color = '0x00000000@1' }
        // text size
    if (e.details.timestamp_font_size && e.details.timestamp_font_size !== '') { x.time_font_size = e.details.timestamp_font_size } else { x.time_font_size = '10' }

    x.time = ' -vf drawtext=time_font=' + x.time_font + ':text=\'%{localtime}\':x=' + x.timex + ':y=' + x.timey + ':fontcolor=' + x.time_color + ':box=1:boxcolor=' + x.time_box_color + ':fontsize=' + x.time_font_size
  } else { x.time = '' }

    // get video and audio codec defaults based on extension
  switch (e.ext) {
    case 'mp4':
      x.vcodec = 'libx264'
      x.acodec = 'aac'
            // video quality
      if (e.details.crf && e.details.crf !== '') { x.vcodec += ' -crf ' + e.details.crf }
      break
    case 'webm':
      x.acodec = 'libvorbis'
      x.vcodec = 'libvpx'
            // video quality
      if (e.details.crf && e.details.crf !== '') { x.vcodec += ' -q:v ' + e.details.crf } else { x.vcodec += ' -q:v 1' }
      break
  }
    // use custom video codec
  if (e.details.vcodec && e.details.vcodec !== '' && e.details.vcodec !== 'default') { x.vcodec = e.details.vcodec }
    // use custom audio codec
  if (e.details.acodec && e.details.acodec !== '' && e.details.acodec !== 'default') { x.acodec = e.details.acodec }
  if (e.details.cust_record) {
    if (x.acodec === 'aac' && e.details.cust_record.indexOf('-strict -2') === -1) { e.details.cust_record += ' -strict -2' }
    if (e.details.cust_record.indexOf('-threads') === -1) { e.details.cust_record += ' -threads 1' }
  }
    //    if(e.details.cust_input&&(e.details.cust_input.indexOf('-use_wallclock_as_timestamps 1')>-1)===false){e.details.cust_input+=' -use_wallclock_as_timestamps 1';}
    // ready or reset codecs
  if (x.acodec !== 'no') {
    if (x.acodec.indexOf('none') > -1) { x.acodec = '' } else { x.acodec = ' -acodec ' + x.acodec }
  } else {
    x.acodec = ' -an'
  }
  if (x.vcodec.indexOf('none') > -1) { x.vcodec = '' } else { x.vcodec = ' -vcodec ' + x.vcodec }
    // stream frames per second
  if (!e.details.sfps || e.details.sfps === '') {
    e.details.sfps = parseFloat(e.details.sfps)
    if (isNaN(e.details.sfps)) { e.details.sfps = 1 }
  }
  if (e.fps && e.fps !== '') { x.framerate = ' -r ' + e.fps } else { x.framerate = '' }
  if (e.details.stream_fps && e.details.stream_fps !== '') { x.stream_fps = ' -r ' + e.details.stream_fps } else { x.stream_fps = '' }
    // recording video filter
  if (e.details.vf && e.details.vf !== '') {
    if (x.time === '') { x.vf = ' -vf ' } else { x.vf = ',' }
    x.vf += e.details.vf
    x.time += x.vf
  }
    // stream video filter
  if (e.details.svf && e.details.svf !== '') { x.svf = ' -vf ' + e.details.svf } else { x.svf = '' }
    // hls vcodec
  if (e.details.stream_vcodec && e.details.stream_vcodec !== 'no') {
    if (e.details.stream_vcodec !== '') { x.stream_vcodec = ' -c:v ' + e.details.stream_vcodec } else { x.stream_vcodec = 'libx264' }
  } else {
    x.stream_vcodec = ''
  }
    // hls acodec
  if (e.details.stream_acodec !== 'no') {
    if (e.details.stream_acodec && e.details.stream_acodec !== '') { x.stream_acodec = ' -c:a ' + e.details.stream_acodec } else { x.stream_acodec = '' }
  } else {
    x.stream_acodec = ' -an'
  }
    // hls segment time
  if (e.details.hls_time && e.details.hls_time !== '') { x.hls_time = e.details.hls_time } else { x.hls_time = 2 } // hls list size
  if (e.details.hls_list_size && e.details.hls_list_size !== '') { x.hls_list_size = e.details.hls_list_size } else { x.hls_list_size = 2 }
    // pipe to client streams, check for custom flags
  if (e.details.cust_stream && e.details.cust_stream !== '') { x.cust_stream = ' ' + e.details.cust_stream } else { x.cust_stream = '' }
    // stream preset
  if (e.details.preset_stream && e.details.preset_stream !== '') { x.preset_stream = ' -preset ' + e.details.preset_stream } else { x.preset_stream = '' }
    // stream quality
  if (e.details.stream_quality && e.details.stream_quality !== '') { x.stream_quality = e.details.stream_quality } else { x.stream_quality = '' }
  switch (e.details.stream_type) {
    case 'hls':
      if (x.cust_stream.indexOf('-tune') === -1) { x.cust_stream += ' -tune zerolatency' }
      if (x.cust_stream.indexOf('-g ') === -1) { x.cust_stream += ' -g 1' }
      if (x.stream_quality) x.stream_quality = ' -crf ' + x.stream_quality
      x.pipe = x.preset_stream + x.stream_quality + x.stream_acodec + x.stream_vcodec + x.stream_fps + ' -f hls -s ' + x.ratio + x.cust_stream + ' -hls_time ' + x.hls_time + ' -hls_list_size ' + x.hls_list_size + ' -start_number 0 -hls_allow_cache 0 -hls_flags +delete_segments+omit_endlist ' + e.sdir + 's.m3u8'
      break
    case 'mjpeg':
      if (x.stream_quality) x.stream_quality = ' -q:v ' + x.stream_quality
      x.pipe = ' -c:v mjpeg -f mpjpeg -boundary_tag shinobi' + x.cust_stream + x.svf + x.stream_quality + x.stream_fps + ' -s ' + x.ratio + ' pipe:1'
      break
    default: // base64
      if (x.stream_quality) x.stream_quality = ' -q:v ' + x.stream_quality
      x.pipe = ' -c:v mjpeg -f image2pipe' + x.cust_stream + x.svf + x.stream_quality + x.stream_fps + ' -s ' + x.ratio + ' pipe:1'
      break
  }
    // motion detector, opencv
  if (e.details.detector === '1') {
    if (!e.details.detector_fps || e.details.detector_fps === '') { e.details.detector_fps = 0.5 }
    if (e.details.detector_scale_x && e.details.detector_scale_x !== '' && e.details.detector_scale_y && e.details.detector_scale_y !== '') { x.dratio = ' -s ' + e.details.detector_scale_x + 'x' + e.details.detector_scale_y } else { x.dratio = '' }
    if (e.details.cust_detect && e.details.cust_detect !== '') { x.cust_detect += e.details.cust_detect }
    x.pipe += ' -c:v mjpeg -f image2pipe -r ' + e.details.detector_fps + x.cust_detect + x.dratio + ' pipe:0'
  }
    // custom output
  if (e.details.custom_output && e.details.custom_output !== '') { x.pipe += ' ' + e.details.custom_output }
    // custom input flags
  if (e.details.cust_input && e.details.cust_input !== '') { x.cust_input += ' ' + e.details.cust_input }
    // loglevel
  if (e.details.loglevel && e.details.loglevel !== '') { x.loglevel = '-loglevel ' + e.details.loglevel } else { x.loglevel = '-loglevel error' }
  if (e.mode === 'record') {
        // custom record flags
    if (e.details.cust_record && e.details.cust_record !== '') { x.watch += ' ' + e.details.cust_record }
        // record preset
    if (e.details.preset_record && e.details.preset_record !== '') { x.watch += ' -preset ' + e.details.preset_record }
  }
  if (!x.vf || x.vf === ',') { x.vf = '' }
  switch (e.type) {
    case 'socket':
    case 'jpeg':
    case 'pipe':
      if (e.mode === 'record') { x.watch += x.vcodec + x.time + x.framerate + x.vf + ' -s ' + e.width + 'x' + e.height + x.segment }
      x.tmp = x.loglevel + ' -pattern_type glob -f image2pipe' + x.framerate + ' -vcodec mjpeg' + x.cust_input + ' -i -' + x.watch + x.pipe
      break
    case 'mjpeg':
      if (e.mode === 'record') {
        x.watch += x.vcodec + x.time + x.vf + x.framerate + ' -s ' + e.width + 'x' + e.height + x.segment
      }
      x.tmp = x.loglevel + ' -reconnect 1 -r ' + e.details.sfps + ' -f mjpeg' + x.cust_input + ' -i ' + e.url + '' + x.watch + x.pipe
      break
    case 'h264':
      if (e.mode === 'record') {
        x.watch += x.vcodec + x.time + x.framerate + x.acodec + ' -s ' + e.width + 'x' + e.height + x.vf + ' ' + x.segment
      }
      x.tmp = x.loglevel + x.cust_input + ' -i ' + e.url + x.watch + x.pipe
      break
    case 'local':
      if (e.mode === 'record') {
        x.watch += x.vcodec + x.time + x.framerate + x.acodec + ' -s ' + e.width + 'x' + e.height + x.vf + ' ' + x.segment
      }
      x.tmp = x.loglevel + x.cust_input + ' -i ' + e.path + '' + x.watch + x.pipe
      break
  }
  s.group[e.ke].mon[e.mid].ffmpeg = x.tmp
  return spawn('ffmpeg', x.tmp.replace(/\s+/g, ' ').trim().split(' '))
}
s.file = (x, e) => {
  if (!e) { e = {} };
  switch (x) {
    case 'size':
      return fs.statSync(e.filename)['size']
    case 'delete':
      if (!e) { return false }
      return exec('rm -rf ' + e)
    case 'delete_files':
      if (!e.age_type) { e.age_type = 'min' };
      if (!e.age) { e.age = '1' };
      exec('find ' + e.path + ' -type f -c' + e.age_type + ' +' + e.age + ' -exec rm -rf {} +')
      break
  }
}
s.camera = (x, e, cn, tx) => {
  let ee = s.init('clean', e)
  if (!e) { e = {} };
  if (cn && cn.ke && !e.ke) { e.ke = cn.ke };
  if (!e.mode) { e.mode = x }
  if (!e.id && e.mid) { e.id = e.mid }
  if (e.details && (e.details instanceof Object) === false) {
    try { e.details = JSON.parse(e.details) } catch (err) {}
  }
  if (e.details && e.details.cords && (e.details.cords instanceof Object) === false) {
    try {
      e.details.cords = JSON.parse(e.details.cords)
      if (!e.details.cords) e.details.cords = []
    } catch (err) {
      e.details.cords = []
    }
  }
  switch (x) {
    case 'snapshot': // get snapshot from monitor URL
      if (e.mon.mode !== 'stop') {
        e.url = s.init('url', e.mon)
        switch (e.mon.type) {
          case 'mjpeg':
          case 'h264':
          case 'local':
            if (e.mon.type === 'local') { e.url = e.mon.path }
            e.spawn = spawn('ffmpeg', ('-loglevel quiet -i ' + e.url + ' -s 400x400 -r 25 -ss 1.8 -frames:v 1 -f singlejpeg pipe:1').split(' '))
            e.spawn.stdout.on('data', (data) => {
              s.emitToRoom({
                f: 'monitor_snapshot',
                snapshot: data.toString('base64'),
                snapshot_format: 'b64',
                mid: e.mid,
                ke: e.ke
              }, 'GRP_' + e.ke)
              e.spawn.kill()
            })
            break
          case 'jpeg':
            request({ url: e.url, method: 'GET', encoding: null }, (err, data) => {
              if (err) {
                s.emitToRoom({
                  f: 'monitor_snapshot',
                  snapshot: 'No Image',
                  snapshot_format: 'plc',
                  mid: e.mid,
                  ke: e.ke
                }, 'GRP_' + e.ke)
                return
              };
              s.emitToRoom({
                f: 'monitor_snapshot',
                snapshot: data.body,
                snapshot_format: 'ab',
                mid: e.mid,
                ke: e.ke
              }, 'GRP_' + e.ke)
            })
            break
          default:
            s.emitToRoom({
              f: 'monitor_snapshot',
              snapshot: '...',
              snapshot_format: 'plc',
              mid: e.mid,
              ke: e.ke
            }, 'GRP_' + e.ke)
            break
        }
      } else {
        s.emitToRoom({
          f: 'monitor_snapshot',
          snapshot: 'Disabled',
          snapshot_format: 'plc',
          mid: e.mid,
          ke: e.ke
        }, 'GRP_' + e.ke)
      }
      break
    case 'record_off': // stop recording and start
      if (!s.group[e.ke].mon[e.id].record) { s.group[e.ke].mon[e.id].record = {} }
      s.group[e.ke].mon[e.id].record.yes = 0
      s.camera('start', e)
      break
    case 'watch_on': // live streamers - join
            //            if(s.group[e.ke].mon[e.id].watch[cn.id]){s.camera('watch_off',e,cn,tx);return}
      s.init(0, { ke: e.ke, mid: e.id })
      if (!cn.monitor_watching) { cn.monitor_watching = {} }
      if (!cn.monitor_watching[e.id]) { cn.monitor_watching[e.id] = { ke: e.ke } }
      s.group[e.ke].mon[e.id].watch[cn.id] = {}
            //            if(Object.keys(s.group[e.ke].mon[e.id].watch).length>0){
            //                sql.query('SELECT * FROM Monitors WHERE ke=? AND mid=?',[e.ke,e.id],(err,r) => {
            //                    if(r&&r[0]){
            //                        r=r[0];
            //                        r.url=s.init('url',r);
            //                        s.group[e.ke].mon.type=r.type;
            //                    }
            //                })
            //            }
      break
    case 'watch_off': // live streamers - leave
      if (cn.monitor_watching) { delete (cn.monitor_watching[e.id]) }
      if (s.group[e.ke].mon[e.id] && s.group[e.ke].mon[e.id].watch) {
        delete (s.group[e.ke].mon[e.id].watch[cn.id])
        e.ob = Object.keys(s.group[e.ke].mon[e.id].watch).length
        if (e.ob === 0) {
          if (s.group[e.ke].mon.type === 'mjpeg') {
                        //                   s.camera({mode:'frame_emitter',id:e.id,ke:e.ke})
          }
          delete (s.group[e.ke].mon[e.id].watch)
        }
      } else {
        e.ob = 0
      }
      if (tx) {
        tx({
          f: 'monitor_watch_off',
          ke: e.ke,
          id: e.id,
          cnid: cn.id
        })
      };
      s.emitToRoom({
        viewers: e.ob,
        ke: e.ke,
        id: e.id
      }, 'MON_' + e.id)
      break
    case 'stop': // stop monitor
      if (!s.group[e.ke] || !s.group[e.ke].mon[e.id]) { return }
      if (s.group[e.ke].mon[e.id].fswatch) {
        s.group[e.ke].mon[e.id].fswatch.close()
        delete (s.group[e.ke].mon[e.id].fswatch)
      }
      if (s.group[e.ke].mon[e.id].open) {
        ee.filename = s.group[e.ke].mon[e.id].open
        ee.ext = s.group[e.ke].mon[e.id].open_ext
        s.video('close', ee)
      }
      if (s.group[e.ke].mon[e.id].last_frame) { delete (s.group[e.ke].mon[e.id].last_frame) }
      if (s.group[e.ke].mon[e.id].started !== 1) { return }
      s.kill(s.group[e.ke].mon[e.id].spawn, e)
      clearInterval(s.group[e.ke].mon[e.id].running)
      s.group[e.ke].mon[e.id].started = 0
      if (s.group[e.ke].mon[e.id].record) { s.group[e.ke].mon[e.id].record.yes = 0 }
      s.log(e, { type: 'Monitor Stopped', msg: 'Monitor session has been ordered to stop.' })
      s.emitToRoom({
        f: 'monitor_stopping',
        mid: e.id,
        ke: e.ke,
        time: s.moment(),
        reason: e.reason
      }, 'GRP_' + e.ke)
      s.camera('snapshot', { mid: e.id, ke: e.ke, mon: e })
      if (e.delete === 1) {
        s.group[e.ke].mon[e.id].delete = setTimeout(() => { delete (s.group[e.ke].mon[e.id]) }, 60000 * 60)
      }
      break
    case 'start':
    case 'record': // watch or record monitor url
      s.init(0, { ke: e.ke, mid: e.id })
      if (!s.group[e.ke].mon_conf) { s.group[e.ke].mon_conf = {} }
      if (!s.group[e.ke].mon_conf[e.id]) { s.group[e.ke].mon_conf[e.id] = s.init('clean', e) }
      e.url = s.init('url', e)
      if (s.group[e.ke].mon[e.id].started === 1) { return }
            // every 15 minutes start a new file.
      s.group[e.ke].mon[e.id].started = 1
      if (x === 'record') {
        s.group[e.ke].mon[e.id].record.yes = 1
      } else {
        s.group[e.ke].mon[e.mid].record.yes = 0
      }
      e.dir = s.dir.videos + e.ke + '/'
      if (!fs.existsSync(e.dir)) {
        fs.mkdirSync(e.dir)
      }
      e.dir = s.dir.videos + e.ke + '/' + e.id + '/'
      if (!fs.existsSync(e.dir)) {
        fs.mkdirSync(e.dir)
      }
      e.sdir = s.dir.streams + e.ke + '/'
      if (!fs.existsSync(e.sdir)) {
        fs.mkdirSync(e.sdir)
      }
      e.sdir = s.dir.streams + e.ke + '/' + e.id + '/'
      if (!fs.existsSync(e.sdir)) {
        fs.mkdirSync(e.sdir)
      } else {
        exec('rm -rf ' + e.sdir + '*')
      }
            // cutoff time and recording check interval
      if (!e.details.cutoff || e.details.cutoff === '') { e.cutoff = 15 } else { e.cutoff = parseFloat(e.details.cutoff) };
      if (isNaN(e.cutoff) === true) { e.cutoff = 15 }
      s.group[e.ke].mon[e.id].fswatch = fs.watch(e.dir, { encoding: 'utf8' }, (eventType, filename) => {
        if (eventType === 'change') {
          clearTimeout(s.group[e.ke].mon[e.id].checker)
          s.group[e.ke].mon[e.id].checker = setTimeout(() => {
            if (s.group[e.ke].mon[e.id].started === 1) {
              e.fn()
              s.log(e, { type: 'FFMPEG Not Recording', msg: { msg: 'Restarting Process' } })
            }
          }, (60000 * e.cutoff) + 10000)
        } else if (eventType === 'rename') {
          if (s.group[e.ke].mon[e.id].open && s.group[e.ke].mon[e.id].record.yes === 1) {
            s.video('close', e)
          }
          e.filename = filename.split('.')[0]
          s.video('open', e)
          s.group[e.ke].mon[e.id].open = e.filename
          s.group[e.ke].mon[e.id].open_ext = e.ext
        }
      })
      s.camera('snapshot', { mid: e.id, ke: e.ke, mon: e })
                // check host to see if has password and user in it
      e.hosty = e.host.split('@')
      if (e.hosty[1]) { e.hosty = e.hosty[1] } else { e.hosty = e.hosty[0] };

      e.error_fatal = (x) => {
        clearTimeout(e.err_fatal_timeout)
        ++e.error_fatal_count
        if (s.group[e.ke].mon[e.id].started === 1) {
          e.err_fatal_timeout = setTimeout(() => {
            if (e.error_fatal_count > e.details.fatal_max) {
              s.camera('stop', { id: e.id, ke: e.ke })
            } else {
              e.fn()
            };
          }, 5000)
        } else {
          s.kill(s.group[e.ke].mon[e.id].spawn, e)
        }
      }
      e.fn = () => { // this function loops to create new files
        if (s.group[e.ke].mon[e.id].started === 1) {
          e.error_fatal_count = 0
          e.error_count = 0
          try {
            if (!e.details.fatal_max || e.details.fatal_max === '') { e.details.fatal_max = 10 } else { e.details.fatal_max = parseFloat(e.details.fatal_max) }
            s.kill(s.group[e.ke].mon[e.id].spawn, e)
            e.draw = (err, o) => {
              if (o.success === true) {
                e.frames = 0
                if (!s.group[e.ke].mon[e.id].record) { s.group[e.ke].mon[e.id].record = { yes: 1 } };
                                    // launch ffmpeg
                s.group[e.ke].mon[e.id].spawn = s.ffmpeg(e)
                                    // on unexpected exit restart
                s.group[e.ke].mon[e.id].spawn_exit = () => {
                  if (e.details.loglevel !== 'quiet') {
                    s.log(e, { type: 'FFMPEG Unexpected Exit', msg: { msg: 'Process Crashed for Monitor : ' + e.id, cmd: s.group[e.ke].mon[e.id].ffmpeg } })
                  }
                  e.error_fatal()
                }
                s.group[e.ke].mon[e.id].spawn.on('end', s.group[e.ke].mon[e.id].spawn_exit)
                s.group[e.ke].mon[e.id].spawn.on('exit', s.group[e.ke].mon[e.id].spawn_exit)
                                        // emitter for mjpeg
                if (!e.details.stream_mjpeg_clients || e.details.stream_mjpeg_clients === '' || isNaN(e.details.stream_mjpeg_clients) === false) { e.details.stream_mjpeg_clients = 20 } else { e.details.stream_mjpeg_clients = parseInt(e.details.stream_mjpeg_clients) }
                s.group[e.ke].mon[e.id].emitter = new events.EventEmitter().setMaxListeners(e.details.stream_mjpeg_clients)
                s.log(e, { type: 'FFMPEG Process Started', msg: { cmd: s.group[e.ke].mon[e.id].ffmpeg } })
                s.emitToRoom({
                  f: 'monitor_starting',
                  mode: x,
                  mid: e.id,
                  time: s.moment()
                }, 'GRP_' + e.ke)
                                    // start workers
                if (e.type === 'jpeg') {
                  if (!e.details.sfps || e.details.sfps === '') {
                    e.details.sfps = parseFloat(e.details.sfps)
                    if (isNaN(e.details.sfps)) { e.details.sfps = 1 }
                  }
                  if (s.group[e.ke].mon[e.id].spawn) {
                    s.group[e.ke].mon[e.id].spawn.stdin.on('error', (err) => {
                      if (err && e.details.loglevel !== 'quiet') {
                        s.log(e, { type: 'STDIN ERROR', msg: err })
                      }
                    })
                  } else {
                    if (x === 'record') {
                      s.log(e, { type: 'FFMPEG START', msg: 'The recording engine for this snapshot based camera could not start. There may be something wrong with your camera configuration. If there are any logs other than this one please post them in the <b>Issues</b> on Github.' })
                      return
                    }
                  }
                  e.captureOne = (f) => {
                    s.group[e.ke].mon[e.id].record.request = request({ url: e.url, method: 'GET', encoding: null, timeout: 3000 }, (err, data) => {
                      if (err) {

                      }
                    }).on('data', (d) => {
                      if (!e.buffer0) {
                        e.buffer0 = [d]
                      } else {
                        e.buffer0.push(d)
                      }
                      if ((d[d.length - 2] === 0xFF && d[d.length - 1] === 0xD9)) {
                        e.buffer0 = Buffer.concat(e.buffer0)
                        ++e.frames
                        if (s.group[e.ke].mon[e.id].spawn && s.group[e.ke].mon[e.id].spawn.stdin) {
                          s.group[e.ke].mon[e.id].spawn.stdin.write(e.buffer0)
                        }
                        if (s.group[e.ke].mon[e.id].started === 1) {
                          s.group[e.ke].mon[e.id].record.capturing = setTimeout(() => {
                            e.captureOne()
                          }, 1000 / e.details.sfps)
                        }
                        e.buffer0 = null
                      }
                      if (!e.timeOut) {
                        e.timeOut = setTimeout(() => {
                          e.error_count = 0
                          delete (e.timeOut)
                        }, 3000)
                      }
                    }).on('error', (err) => {
                      ++e.error_count
                      clearTimeout(e.timeOut)
                      delete (e.timeOut)
                      if (e.details.loglevel !== 'quiet') {
                        s.log(e, { type: 'Snapshot Error', msg: { msg: 'There was an issue getting data from your camera.', info: err } })
                      }
                      if (e.error_count > e.details.fatal_max) {
                        clearTimeout(s.group[e.ke].mon[e.id].record.capturing)
                        e.fn()
                      }
                    })
                  }
                  e.captureOne()
                }
                if (!s.group[e.ke] || !s.group[e.ke].mon[e.id]) { s.init(0, e) }
                s.group[e.ke].mon[e.id].spawn.on('error', (er) => {
                  s.log(e, { type: 'Spawn Error', msg: er })
                  e.error_fatal()
                })
                                        // frames from motion detect
                s.group[e.ke].mon[e.id].spawn.stdin.on('data', (d) => {
                  if (s.ocv && e.details.detector === '1') {
                    s.emitToRoom({
                      f: 'frame',
                      mon: s.group[e.ke].mon_conf[e.id].details,
                      ke: e.ke,
                      id: e.id,
                      time: s.moment(),
                      frame: d
                    }, s.ocv.id)
                  };
                })
                                        // frames to stream
                ++e.frames
                switch (e.details.stream_type) {
                  case 'mjpeg':
                    e.frame_to_stream = (d) => {
                                                //                                           s.group[e.ke].mon[e.id].last_frame=d;
                      s.group[e.ke].mon[e.id].emitter.emit('data', d)
                    }
                    break
                  case 'b64':
                  case undefined:
                  case null:
                    e.frame_to_stream = (d) => {
                      if (s.group[e.ke] && s.group[e.ke].mon[e.id] && s.group[e.ke].mon[e.id].watch && Object.keys(s.group[e.ke].mon[e.id].watch).length > 0) {
                        if (!e.buffer) {
                          e.buffer = [d]
                        } else {
                          e.buffer.push(d)
                        }
                        if ((d[d.length - 2] === 0xFF && d[d.length - 1] === 0xD9)) {
                          e.buffer = Buffer.concat(e.buffer)
                          s.emitToRoom({
                            f: 'monitor_frame',
                            ke: e.ke,
                            id: e.id,
                            time: s.moment(),
                            frame: e.buffer.toString('base64'),
                            frame_format: 'b64'
                          }, 'MON_' + e.id)
                          e.buffer = null
                        }
                      }
                    }
                    break
                }
                if (e.frame_to_stream) {
                  s.group[e.ke].mon[e.id].spawn.stdout.on('data', e.frame_to_stream)
                }
                if (x === 'record' || e.type === 'mjpeg' || e.type === 'h264' || e.type === 'local') {
                  s.group[e.ke].mon[e.id].spawn.stderr.on('data', (d) => {
                    d = d.toString()
                    e.chk = (x) => { return d.indexOf(x) > -1 }
                    switch (true) {
                      case e.chk('NULL @'):
                      case e.chk('RTP: missed'):
                      case e.chk('deprecated pixel format used, make sure you did set range correctly'):
                        return
                                                    //                                                case e.chk('av_interleaved_write_frame'):
                      case e.chk('Connection refused'):
                      case e.chk('Connection timed out'):
                                                    // restart
                        setTimeout(() => {
                          s.log(e, { type: "Can't Connect", msg: 'Retrying...' })
                          e.error_fatal()
                        }, 1000)
                        break
                      case e.chk('No pixel format specified'):
                        s.log(e, { type: 'FFMPEG STDERR', msg: { ffmpeg: s.group[e.ke].mon[e.id].ffmpeg, msg: d } })
                        break
                      case e.chk('No such file or directory'):
                      case e.chk('Unable to open RTSP for listening'):
                      case e.chk('timed out'):
                      case e.chk('Invalid data found when processing input'):
                      case e.chk('Immediate exit requested'):
                      case e.chk('reset by peer'):
                        if (e.frames === 0 && x === 'record') { s.video('delete', e) };
                        setTimeout(() => {
                          if (!s.group[e.ke].mon[e.id].spawn) { e.fn() }
                        }, 2000)
                        break
                      case e.chk('mjpeg_decode_dc'):
                      case e.chk('bad vlc'):
                      case e.chk('error dc'):
                        e.fn()
                        break
                      case /T[0-9][0-9]-[0-9][0-9]-[0-9][0-9]./.test(d):
                        return s.log(e, { type: 'Video Finished', msg: { filename: d } })
                    }
                    s.log(e, { type: 'FFMPEG STDERR', msg: d })
                  })
                }
              } else {
                s.log(e, { type: "Can't Connect", msg: 'Retrying...' })
                e.error_fatal()
              }
            }
            if (e.type !== 'socket' && e.protocol !== 'udp') {
              connectionTester.test(e.hosty, e.port, 2000, e.draw)
            } else {
              e.draw(null, { success: true })
            }
          } catch (err) {
            ++e.error_count
            console.error('Frame Capture Error ' + e.id, err)
            s.emitToRoom({
              f: 'error',
              data: err
            }, 'GRP_2Df5hBE')
          }
        } else {
          s.kill(s.group[e.ke].mon[e.id].spawn, e)
        }
      }
                // start drawing files
      e.fn()
      break
  }

  if (typeof cn === 'function') {
    console.log(cn)
    setTimeout(() => { cn() }, 1000)
  }
    //    s.init('sync',e)
}

/// /socket controller
s.cn = (cn) => { return { id: cn.id, ke: cn.ke, uid: cn.uid } }
io.on('connection', (cn) => {
  let tx
  cn.on('f', (d) => {
    if (!cn.ke && d.f === 'init') {
      cn.ip = cn.request.connection.remoteAddress
      tx = (z) => {
        if (!z.ke) { z.ke = cn.ke };
        cn.emit('f', z)
      }
      sql.query('SELECT ke,uid,auth,mail,details FROM Users WHERE ke=? AND auth=? AND uid=?', [d.ke, d.auth, d.uid], (err, r) => {
        if (r && r[0]) {
          r = r[0]
          cn.join('GRP_' + d.ke)
          cn.join('CPU')
          cn.ke = d.ke
          cn.uid = d.uid
          cn.auth = d.auth
          if (!s.group[d.ke]) s.group[d.ke] = {}
                    //                    if(!s.group[d.ke].vid)s.group[d.ke].vid={};
          if (!s.group[d.ke].users) s.group[d.ke].users = {}
                    //                    s.group[d.ke].vid[cn.id]={uid:d.uid};
          s.group[d.ke].users[d.auth] = { cnid: cn.id }
          if (!s.group[d.ke].mon) {
            s.group[d.ke].mon = {}
            if (!s.group[d.ke].mon) { s.group[d.ke].mon = {} }
          }
          if (s.ocv) {
            tx({ f: 'detector_plugged', plug: s.ocv.plug })
          }
          s.init('apps', d)
          sql.query('SELECT * FROM API WHERE ke=? && uid=?', [d.ke, d.uid], (err, rrr) => {
            sql.query('SELECT * FROM Monitors WHERE ke=?', [d.ke], (err, rr) => {
              tx({
                f: 'init_success',
                monitors: rr,
                users: s.group[d.ke].vid,
                apis: rrr,
                os: {
                  platform: s.platform,
                  cpuCount: os.cpus().length,
                  totalmem: os.totalmem()
                }
              })
              s.disk(cn.id)
              setTimeout(() => {
                if (rr && rr[0]) {
                  rr.forEach((t) => {
                    s.camera('snapshot', { mid: t.mid, ke: t.ke, mon: t })
                  })
                }
              }, 2000)
            })
          })
        } else {
          tx({ ok: false, msg: 'Not Authorized', token_used: d.auth, ke: d.ke })
          cn.disconnect()
        }
      })
      return
    }
    if ((d.id || d.uid || d.mid) && cn.ke) {
      try {
        switch (d.f) {
          case 'update':
            if (!config.updateKey) {
              tx({ error: '"updateKey" is missing from "conf.json", cannot do updates this way until you add it.' })
              return
            }
            if (d.key === config.updateKey) {
              exec(path.join('chmod +x ', __dirname, '/UPDATE.sh&&', __dirname, '/./UPDATE.sh'))
            } else {
              tx({ error: '"updateKey" is incorrect.' })
            }
            break
          case 'get':
            switch (d.ff) {
              case 'videos':
                d.cx = { f: 'get_videos', mid: d.mid }
                d.sql = 'SELECT * FROM Videos WHERE ke=?'
                d.ar = [d.ke]
                if (d.mid) {
                  d.sql += ' AND mid=?'
                  d.ar.push(d.mid)
                }
                d.sql += ' ORDER BY `end` DESC'
                if (d.limit) { d.sql += ' LIMIT ' + d.limit }
                sql.query(d.sql, d.ar, (err, r) => {
                  d.cx[d.ff] = r
                  tx(d.cx)
                })
                break
            }
            break
          case 'api':
            switch (d.ff) {
              case 'delete':
                d.set = []
                d.ar = []
                d.form.ke = cn.ke
                d.form.uid = cn.uid
                delete (d.form.ip)
                if (!d.form.code) { tx({ f: 'form_incomplete', form: 'APIs' }); return }
                d.for = Object.keys(d.form)
                d.for.forEach((v) => {
                  d.set.push(v + '=?')
                  d.ar.push(d.form[v])
                })
                sql.query('DELETE FROM API WHERE ' + d.set.join(' AND '), d.ar, (err, r) => {
                  if (!err) {
                    tx({ f: 'api_key_deleted', form: d.form })
                    // s.api[xx.auth] = d.form.code
                  } else {
                    console.log(err)
                  }
                })
                break
              case 'add':
                d.set = []
                d.qu = []
                d.ar = []
                d.form.ke = cn.ke
                d.form.uid = cn.uid
                d.form.code = s.gid(30)
                d.form.details = '{}'
                d.for = Object.keys(d.form)
                d.for.forEach((v) => {
                  d.set.push(v)
                  d.qu.push('?')
                  d.ar.push(d.form[v])
                })
                d.ar.push(cn.ke)
                sql.query('INSERT INTO API (' + d.set.join(',') + ') VALUES (' + d.qu.join(',') + ')', d.ar, (err, r) => {
                  d.form.time = s.moment(new Date(), 'YYYY-DD-MM HH:mm:ss')
                  if (!err) { tx({ f: 'api_key_added', form: d.form }) } else { console.log(err) }
                })
                break
            }
            break
          case 'settings':
            switch (d.ff) {
              case 'edit':
                sql.query('SELECT details FROM Users WHERE ke=? AND uid=?', [d.ke, d.uid], (err, r) => {
                  if (r && r[0]) {
                    r = r[0]
                    d.d = JSON.parse(r.details)
                                        /// unchangeable from client side, so reset them incase they did.
                    if (d.d.sub) {
                      d.form.details = JSON.parse(d.form.details)
                      if (d.d.sub) { d.form.details.sub = d.d.sub }
                      if (d.d.size) { d.form.details.size = d.d.size }
                      if (d.d.super) { d.form.details.super = d.d.super }
                      d.form.details = JSON.stringify(d.form.details)
                    }

                    d.set = []
                    d.ar = []
                    if (d.form.pass && d.form.pass !== '') { d.form.pass = s.md5(d.form.pass) } else { delete (d.form.pass) };
                    delete (d.form.password_again)
                    d.for = Object.keys(d.form)
                    d.for.forEach((v) => {
                      d.set.push(v + '=?')
                      d.ar.push(d.form[v])
                    })
                    d.ar.push(d.ke)
                    d.ar.push(d.uid)
                    sql.query('UPDATE Users SET ' + d.set.join(',') + ' WHERE ke=? AND uid=?', d.ar, (err, r) => {
                      tx({ f: 'user_settings_change', uid: d.uid, ke: d.ke, form: d.form })
                    })
                    d.form.details = JSON.parse(d.form.details)
                    if (!d.form.details.sub) {
                      if (d.form.details.webdav_user &&
                                                d.form.details.webdav_user !== '' &&
                                                d.form.details.webdav_pass &&
                                                d.form.details.webdav_pass !== '' &&
                                                d.form.details.webdav_url &&
                                                d.form.details.webdav_url !== ''
                                            ) {
                        if (!d.form.details.webdav_dir || d.form.details.webdav_dir === '') {
                          d.form.details.webdav_dir = '/'
                          if (d.form.details.webdav_dir.slice(-1) !== '/') { d.form.details.webdav_dir += '/' }
                        }
                        s.group[d.ke].webdav = webdav(
                                                    d.form.details.webdav_url,
                                                    d.form.details.webdav_user,
                                                    d.form.details.webdav_pass
                                                )
                        s.group[d.ke].init = d.form.details
                      } else {
                        delete (s.group[d.ke].webdav)
                      }
                    }
                  }
                })
                break
            }
            break
          case 'monitor':
            switch (d.ff) {
              case 'control':
                if (!s.group[d.ke] || !s.group[d.ke].mon[d.mid]) { return }
                d.m = s.group[d.ke].mon_conf[d.mid]
                if (d.m.details.control !== '1') { s.log(d, { type: 'Control Error', msg: 'Control is not enabled' }); return }
                d.base = s.init('url_no_path', d.m)
                if (!d.m.details.control_url_stop_timeout || d.m.details.control_url_stop_timeout === '') { d.m.details.control_url_stop_timeout = 1000 }
                request({ url: d.base + d.m.details['control_url_' + d.direction], method: 'GET' }, (err, data) => {
                  if (err) { s.log(d, { type: 'Control Error', msg: err }); return false }
                  if (d.m.details.control_stop === '1' && d.direction !== 'center') {
                    setTimeout(() => {
                      request({ url: d.base + d.m.details['control_url_' + d.direction + '_stop'], method: 'GET' }, (er, dat) => {
                        if (err) { s.log(d, { type: 'Control Error', msg: err }); return false }
                        s.emitToRoom({
                          f: 'control',
                          ok: data,
                          mid: d.mid,
                          ke: d.ke,
                          direction: d.direction,
                          url_stop: true
                        })
                      })
                    }, d.m.details.control_url_stop_timeout)
                  } else {
                    tx({ f: 'control', ok: data, mid: d.mid, ke: d.ke, direction: d.direction, url_stop: false })
                  }
                })
                break
              case 'delete':
                if (!d.ke) { d.ke = cn.ke };
                if (d.mid) {
                  d.delete = 1
                  s.camera('stop', d)
                  s.emitToRoom({
                    f: 'monitor_delete',
                    uid: cn.uid,
                    mid: d.mid,
                    ke: cn.ke
                  }, 'GRP_' + d.ke)
                  s.log(d, { type: 'Monitor Deleted', msg: 'by user : ' + cn.uid })
                  sql.query('DELETE FROM Monitors WHERE ke=? AND mid=?', [d.ke, d.mid])
                }
                break
              case 'add':
                if (d.mon && d.mon.mid && d.mon.name) {
                  d.set = []
                  d.ar = []
                  d.mon.mid = d.mon.mid.replace(/[^\w\s]/gi, '').replace(/ /g, '')
                  if (!d.mon.ke) { d.mon.ke = cn.ke }
                  sql.query('SELECT * FROM Monitors WHERE ke=? AND mid=?', [d.mon.ke, d.mon.mid], (er, r) => {
                    d.tx = { f: 'monitor_edit', mid: d.mon.mid, ke: d.mon.ke, mon: d.mon }
                    if (r && r[0]) {
                      d.tx.new = false
                      Object.keys(d.mon).forEach((v) => {
                        if (d.mon[v] && d.mon[v] !== '') {
                          d.set.push(v + '=?')
                          d.ar.push(d.mon[v])
                        }
                      })
                      d.set = d.set.join(',')
                      d.ar.push(d.mon.ke)
                      d.ar.push(d.mon.mid)
                      s.log(d, { type: 'Monitor Updated', msg: 'by user : ' + cn.uid })
                      sql.query('UPDATE Monitors SET ' + d.set + ' WHERE ke=? AND mid=?', d.ar)
                    } else {
                      d.tx.new = true
                      d.st = []
                      Object.keys(d.mon).forEach((v) => {
                        if (d.mon[v] && d.mon[v] !== '') {
                          d.set.push(v)
                          d.st.push('?')
                          d.ar.push(d.mon[v])
                        }
                      })
                                                //                                        d.set.push('ke'),d.st.push('?'),d.ar.push(d.mon.ke);
                      d.set = d.set.join(',')
                      d.st = d.st.join(',')
                      s.log(d, { type: 'Monitor Added', msg: 'by user : ' + cn.uid })
                      sql.query('INSERT INTO Monitors (' + d.set + ') VALUES (' + d.st + ')', d.ar)
                    }
                    s.group[d.mon.ke].mon_conf[d.mon.mid] = d.mon
                    if (d.mon.mode === 'stop') {
                      d.mon.delete = 1
                      s.camera('stop', d.mon)
                    } else {
                      s.camera('stop', d.mon)
                      setTimeout(() => { s.camera(d.mon.mode, d.mon) }, 5000)
                    };
                    s.emitToRoom(d.tx, 'GRP_' + d.mon.ke)
                    s.emitToRoom(d.tx, 'STR_' + d.mon.ke)
                  })
                }
                break
              case 'record_on':
              case 'record_off':
                if (!d.ke) { d.ke = cn.ke }
                sql.query('SELECT * FROM Monitors WHERE ke=? AND mid=?', [cn.ke, d.id], (err, r) => {
                  if (r && r[0]) {
                    r = r[0]
                    if (d.ff === 'record_on') { d.mode = 'record' } else { d.mode = 'start' };
                    d.type = r.type
                    sql.query('UPDATE Monitors SET mode=? WHERE mid=? AND ke=?', [d.mode, d.id, d.ke], () => {
                      d.callback = () => {
                        delete (d.callback)
                        s.camera(d.mode, d)
                      }
                      s.camera('stop', d)
                      tx({ f: d.ff, id: d.id })
                    })
                  }
                })
                break
              case 'watch_on':
                if (!d.ke) { d.ke = cn.ke }
                s.init(0, { mid: d.id, ke: d.ke })
                if (!s.group[d.ke] || !s.group[d.ke].mon[d.id] || s.group[d.ke].mon[d.id].started === 0) { return false }
                s.camera(d.ff, d, cn, tx)
                cn.join('MON_' + d.id)
                if (s.group[d.ke] && s.group[d.ke].mon && s.group[d.ke].mon[d.id] && s.group[d.ke].mon[d.id].watch) {
                  tx({ f: 'monitor_watch_on', id: d.id, ke: d.ke }, 'MON_' + d.id)
                  s.emitToRoom({
                    viewers: Object.keys(s.group[d.ke].mon[d.id].watch).length,
                    ke: d.ke,
                    id: d.id
                  }, 'MON_' + d.id)
                }
                break
              case 'watch_off':
                if (!d.ke) { d.ke = cn.ke };
                cn.leave('MON_' + d.id)
                s.camera(d.ff, d, cn, tx)
                s.emitToRoom({
                  viewers: d.ob,
                  ke: d.ke,
                  id: d.id
                }, 'MON_' + d.id)
                break
              case 'start':
              case 'stop':
                sql.query('SELECT * FROM Monitors WHERE ke=? AND mid=?', [cn.ke, d.id], (err, r) => {
                  if (r && r[0]) {
                    r = r[0]
                    s.camera(d.ff, { type: r.type, url: s.init('url', r), id: d.id, mode: d.ff, ke: cn.ke })
                  }
                })
                break
            }
            break
          case 'video':
            switch (d.ff) {
              case 'delete':
                s.video('delete', d)
                break
            }
            break
          case 'ffprobe':
            if (s.group[cn.ke].users[cn.auth]) {
              switch (d.ff) {
                case 'stop':
                  exec('kill -9 ' + s.group[cn.ke].users[cn.auth].ffprobe.pid)
                  break
                default:
                  if (s.group[cn.ke].users[cn.auth].ffprobe) {
                    exec('kill -9 ' + s.group[cn.ke].users[cn.auth].ffprobe.pid)
                  }
                  s.group[cn.ke].users[cn.auth].ffprobe = spawn('ffprobe', d.query.split(' '))
                  tx({ f: 'ffprobe_start', pid: s.group[cn.ke].users[cn.auth].ffprobe.pid })
                  s.group[cn.ke].users[cn.auth].ffprobe.on('exit', (data) => {
                    tx({ f: 'ffprobe_stop', pid: s.group[cn.ke].users[cn.auth].ffprobe.pid })
                  })
                  s.group[cn.ke].users[cn.auth].ffprobe.stderr.on('data', (data) => {
                    tx({ f: 'ffprobe_data', data: data.toString('utf8'), pid: s.group[cn.ke].users[cn.auth].ffprobe.pid })
                  })
                                    // auto kill in 30 seconds
                  setTimeout(() => {
                    exec('kill -9 ' + d.pid)
                  }, 30000)
                  break
              }
            }
            break
          case 'onvif':
                        // check ip
            d.ip = d.ip.replace(/ /g, '')
            if (d.ip.indexOf('-') > -1) {
              d.ip = d.ip.split('-')
              d.IP_RANGE_START = d.ip[0]
              d.IP_RANGE_END = d.ip[1]
            } else {
              d.IP_RANGE_START = d.ip
              d.IP_RANGE_END = d.ip
            }
            d.IP_LIST = s.ipRange(d.IP_RANGE_START, d.IP_RANGE_END)
                        // check port
            d.port = d.port.replace(/ /g, '')
            if (d.port.indexOf('-') > -1) {
              d.port = d.port.split('-')
              d.PORT_RANGE_START = d.port[0]
              d.PORT_RANGE_END = d.port[1]
              d.PORT_LIST = s.portRange(d.PORT_RANGE_START, d.PORT_RANGE_END)
            } else {
              d.PORT_LIST = d.port.split(',')
            }
                        // check user name and pass
            d.USERNAME = ''
            if (d.user) {
              d.USERNAME = d.user
            }
            d.PASSWORD = ''
            if (d.pass) {
              d.PASSWORD = d.pass
            }

            d.cams = {}
                            // try each IP address and each Port
            d.IP_LIST.forEach((ipEntry, n) => {
              d.PORT_LIST.forEach((portEntry, nn) => {
                return new Cam({
                  hostname: ipEntry,
                  username: d.USERNAME,
                  password: d.PASSWORD,
                  port: portEntry,
                  timeout: 5000
                }, function CamFunc (err) {
                  if (err) return
                  err = { f: 'onvif', ip: ipEntry, port: portEntry }
                  let camObj = this
                  camObj.getSystemDateAndTime((er, date, xml) => {
                    if (!er) err.date = date
                    camObj.getDeviceInformation((er, info, xml) => {
                      if (!er) err.info = info
                      try {
                        camObj.getStreamUri({
                          protocol: 'RTSP'
                        }, (er, stream, xml) => {
                          if (!er) err.url = stream
                          tx(err)
                        })
                      } catch (err) {
                        tx(err)
                      }
                    })
                  })
                })
              }) // foreach
            }) // foreach
            break
        }
      } catch (er) { console.log(er) }
    } else {
      tx({ ok: false, msg: 'Not Authorized, Submit init command with "auth","ke", and "uid"' })
    }
  })
    // functions for retrieving cron announcements
  cn.on('ocv', (d) => {
    switch (d.f) {
      case 'init':
        s.ocv = { started: moment(), id: cn.id, plug: d.plug }
        cn.ocv = 1
        s.emitToRoom({
          f: 'detector_plugged',
          plug: d.plug
        }, 'CPU')
        console.log('Connected to plugin : Detector - ' + d.plug)
        break
      case 'trigger':
                    // got a frame rendered with a marker
        s.emitToRoom({
          f: 'detector_trigger',
          id: d.id,
          ke: d.ke,
          details: d.details
        }, 'GRP_' + d.ke)
        if (d.ke && d.id && s.group[d.ke] && s.group[d.ke].mon_conf[d.id]) {
          d.mon = s.group[d.ke].mon_conf[d.id]
          if (s.group[d.ke].mon_conf[d.id].details.detector_trigger === '1') {
            if (!s.group[d.ke].mon[d.id].watchdog_stop) {
              d.mon.mode = 'stop'
              s.camera('stop', d.mon)
              setTimeout(() => {
                d.mon.mode = 'record'
                s.camera('record', d.mon)
              }, 3000)
            }
            if (!d.mon.details.detector_timeout || d.mon.details.detector_timeout === '') {
              d.mon.details.detector_timeout = 10
            }
            d.detector_timeout = parseFloat(d.mon.details.detector_timeout) * 1000 * 60

            clearTimeout(s.group[d.ke].mon[d.id].watchdog_stop)

            s.group[d.ke].mon[d.id].watchdog_stop = setTimeout(() => {
              d.mon.mode = 'stop'
              s.camera('stop', d.mon)
              setTimeout(() => {
                d.mon.mode = 'start'
                s.camera('start', d.mon)
                delete (s.group[d.ke].mon[d.id].watchdog_stop)
              }, 3000)
            }, d.detector_timeout)
          }
          if (d.mon.details.detector_save === '1') {
            sql.query('INSERT INTO Events (ke,mid,details) VALUES (?,?,?)', [d.ke, d.id, JSON.stringify(d.details)])
          }
        }
        break
      case 'frame':
                    // got a frame rendered with a marker
                    //                console.log('Look!',d.frame)
        break
      case 'sql':
        sql.query(d.query, d.values)
        break
    }
  })
        // functions for retrieving cron announcements
  cn.on('cron', (d) => {
    switch (d.f) {
      case 'init':
        s.cron = { started: moment(), last_run: moment() }
        break
      case 'msg':

        break
      case 's.tx':
        s.emitToRoom(d.data, d.to)
        break
      case 'start':
      case 'end':
        d.mid = '_cron'
        s.log(d, { type: 'cron', msg: d.msg })
        break
      default:
        console.log('CRON : ', d)
        break
    }
  })
        // admin page socket functions
  cn.on('a', (d) => {
    if (!cn.shinobi_child && d.f === 'init') {
      sql.query('SELECT * FROM Users WHERE auth=? && uid=?', [d.auth, d.uid], (err, r) => {
        if (r && r[0]) {
          if (!s.group[d.ke]) { s.group[d.ke] = { users: {} } }
          if (!s.group[d.ke].users[d.auth]) { s.group[d.ke].users[d.auth] = { cnid: cn.id } }
          cn.join('ADM_' + d.ke)
          cn.ke = d.ke
          cn.uid = d.uid
          cn.auth = d.auth
        } else {
          cn.disconnect()
        }
      })
    } else {
      s.auth({ auth: d.auth, ke: d.ke, id: d.id }, () => {
        switch (d.f) {
          case 'accounts':
            switch (d.ff) {
              case 'delete':
                sql.query('DELETE FROM Users WHERE uid=? AND ke=? AND mail=?', [d.$uid, cn.ke, d.mail])
                s.emitToRoom({
                  f: 'delete_sub_account',
                  ke: cn.ke,
                  uid: d.$uid,
                  mail: d.mail
                }, 'ADM_' + d.ke)
                break
            }
            break
        }
      }, null, null, sql)
    }
  })
        // functions for webcam recorder
  cn.on('r', (d) => {
    if (!s.group[d.ke] || !s.group[d.ke].mon[d.mid]) { return }
    switch (d.f) {
      case 'monitor_frame':
        if (s.group[d.ke].mon[d.mid].started !== 1) {
          s.emitToRoom({
            error: 'Not Started'
          }, cn.id)
          return false
        };
        if (s.group[d.ke] && s.group[d.ke].mon[d.mid] && s.group[d.ke].mon[d.mid].watch && Object.keys(s.group[d.ke].mon[d.mid].watch).length > 0) {
          s.emitToRoom({
            f: 'monitor_frame',
            ke: d.ke,
            id: d.mid,
            time: s.moment(),
            frame: d.frame.toString('base64')
          }, 'MON_' + d.mid)
        }
        if (s.group[d.ke].mon[d.mid].record.yes === 1) {
          s.group[d.ke].mon[d.mid].spawn.stdin.write(d.frame)
        }
        break
    }
  })

        // embed functions
  cn.on('e', (d) => {
    tx = (z) => {
      if (!z.ke) { z.ke = cn.ke };
      cn.emit('f', z)
    }
    switch (d.f) {
      case 'init':
        if (!s.group[d.ke] || !s.group[d.ke].mon[d.id] || s.group[d.ke].mon[d.id].started === 0) { return false }
        s.auth({ auth: d.auth, ke: d.ke, id: d.id }, () => {
          cn.embedded = 1
          cn.ke = d.ke
          if (!cn.mid) { cn.mid = {} }
          cn.mid[d.id] = {}

          s.camera('watch_on', d, cn, tx)
          cn.join('MON_' + d.id)
          cn.join('STR_' + d.ke)
          if (s.group[d.ke] && s.group[d.ke].mon && s.group[d.ke].mon[d.id] && s.group[d.ke].mon[d.id].watch) {
            tx({ f: 'monitor_watch_on', id: d.id, ke: d.ke }, 'MON_' + d.id)
            s.emitToRoom({
              viewers: Object.keys(s.group[d.ke].mon[d.id].watch).length,
              ke: d.ke,
              id: d.id
            }, 'MON_' + d.id)
          }
        }, null, null, sql)
        break
    }
  })
  cn.on('disconnect', () => {
    if (cn.ke) {
      if (cn.monitor_watching) {
        cn.monitor_count = Object.keys(cn.monitor_watching)
        if (cn.monitor_count.length > 0) {
          cn.monitor_count.forEach((v) => {
            s.camera('watch_off', { id: v, ke: cn.monitor_watching[v].ke }, s.cn(cn))
          })
        }
      }
      if (!cn.embedded) {
        delete (s.group[cn.ke].users[cn.auth])
      }
            //            delete(s.group[cn.ke].vid[cn.id]);
    }
    if (cn.ocv) {
      s.emitToRoom({ f: 'detector_unplugged', plug: s.ocv.plug }, 'CPU')
      delete (s.ocv)
    }
    if (cn.cron) {
      delete (s.cron)
    }
  })
})
// Authenticator
s.api = {}
s.auth = (reqParams, authenticationFunction, res, req, db) => {
  if (s.group[reqParams.ke] && s.group[reqParams.ke].users && s.group[reqParams.ke].users[reqParams.auth]) {
    authenticationFunction()
  } else {
    if (s.api[reqParams.auth]) {
      authenticationFunction()
    } else {
      db.query('SELECT * FROM API WHERE code=?', [reqParams.auth], (err, r) => {
        if (r && r[0]) {
          s.api[reqParams.auth] = {}
          authenticationFunction()
        } else {
          if (req) {
            if (!req.ret) { req.ret = { ok: false } }
            req.ret.msg = 'Not Authorized'
            res.send(s.s(req.ret, null, 3))
          }
        }
      })
    }
  }
}

let router = require('./modules/router.js')
router.route(app)

// update server
let updateAuthKeyHandler = (req, res) => {
  req.ret = { ok: false }
  res.setHeader('Content-Type', 'application/json')
  req.fn = () => {
    if (!config.updateKey) {
      req.ret.msg = '"updateKey" is missing from "conf.json", cannot do updates this way until you add it.'
      return
    }
    if (req.params.key === config.updateKey) {
      req.ret.ok = true
      exec(path.join('chmod +x ', __dirname, '/UPDATE.sh&&', __dirname, '/./UPDATE.sh'))
    } else {
      req.ret.msg = '"updateKey" is incorrect.'
    }
    res.send(s.s(req.ret, null, 3))
  }
  s.auth(req.params, req.fn, res, req, sql)
}
app.get('/:auth/update/:key', updateAuthKeyHandler)

// register function
let registerUserHandler = (req, res) => {
  req.resp = { ok: false }
  res.setHeader('Content-Type', 'application/json')

  s.auth(req.params, () => {
    sql.query('SELECT * FROM Users WHERE uid=? AND ke=? AND details NOT LIKE ? LIMIT 1', [req.params.uid, req.params.ke, '%"sub"%'], (err, users) => {
      if (!users || !users[0]) {
        req.resp.msg = 'Not an Administrator Account'
      }

      if (req.body.mail === '' || req.body.pass === '') {
        req.resp.msg = 'Fields cannot be empty'
      }

      if (req.body.pass !== req.body.password_again) {
        req.resp.msg = 'Passwords Don\'t Match'
      }

      sql.query('SELECT count(*) FROM Users WHERE mail=?', [req.body.mail], (err, count) => {
        if (count[0]['count(*)'] > 0) { // found one exist
          req.resp.msg = 'Email address is in use.'
        } else { // create new
          req.resp.msg = 'New Account Created'
          req.resp.ok = true
          req.gid = s.gid()
          sql.query('INSERT INTO Users (ke,uid,mail,pass,details) VALUES (?,?,?,?,?)', [req.params.ke, req.gid, req.body.mail, s.md5(req.body.pass), '{"sub":"1"}'])
          s.emitToRoom({
            f: 'add_sub_account',
            ke: req.params.ke,
            uid: req.gid,
            mail: req.body.mail
          }, 'ADM_' + req.params.ke)
        }
        res.send(s.s(req.resp, null, 3))
      })

      if (req.resp.msg) {
        res.send(s.s(req.resp, null, 3))
      }
    })
  }, res, req, sql)
}

app.post('/:auth/register/:ke/:uid', registerUserHandler)

// login function
let loginHandler = (req, res) => {
  if (req.body.mail && req.body.pass) {
    sql.query('SELECT * FROM Users WHERE mail=? AND pass=?', [req.body.mail, s.md5(req.body.pass)], (err, r) => {
      req.resp = { ok: false }
      if (!err && r && r[0]) {
        r = r[0]
        r.auth = s.md5(s.gid())
        sql.query('UPDATE Users SET auth=? WHERE ke=? AND uid=?', [r.auth, r.ke, r.uid])
        req.resp = { ok: true, auth_token: r.auth, ke: r.ke, uid: r.uid, mail: r.mail, details: r.details, dropbox: config.dropbox }
        r.details = JSON.parse(r.details)
        if (req.body.classic) {
          res.render('classic', { $user: req.resp })
        } else {
          if (req.body.admin) {
                        // admin checkbox selected
            if (!r.details.sub) {
              sql.query('SELECT uid,mail,details FROM Users WHERE ke=? AND details LIKE \'%"sub"%\'', [r.ke], (err, r) => {
                res.render('admin', { $user: req.resp, $subs: r })
              })
            }
          } else {
                        // no admin checkbox selected
            if (!req.body.recorder) {
                            // dashboard
              res.render('home', { $user: req.resp })
            } else {
                            // streamer
              sql.query('SELECT * FROM Monitors WHERE ke=? AND type=?', [r.ke, 'socket'], (err, rr) => {
                req.resp.mons = rr
                res.render('streamer', { $user: req.resp })
              })
            }
          }
        }
      } else {
        res.render('index', { failedLogin: true })
        res.end()
      }
    })
  }
}

app.post('/', loginHandler)

// Get HLS stream (m3u8)
app.get('/:auth/hls/:ke/:id/:file', (req, res) => {
  req.fn = () => {
    req.dir = s.dir.streams + req.params.ke + '/' + req.params.id + '/' + req.params.file
    if (fs.existsSync(req.dir)) {
      fs.createReadStream(req.dir).pipe(res)
    } else {
      res.send('File Not Found')
    }
  }
  s.auth(req.params, req.fn, res, req, sql)
})
// Get MJPEG stream
app.get(['/:auth/mjpeg/:ke/:id', '/:auth/mjpeg/:ke/:id/:addon'], (req, res) => {
  if (req.params.addon === 'full') {
    res.render('mjpeg', { url: '/' + req.params.auth + '/mjpeg/' + req.params.ke + '/' + req.params.id })
  } else {
    s.auth(req.params, () => {
      res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=shinobi',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache'
      })
      let contentWriter
      let content = fs.readFileSync(config.defaultMjpeg, 'binary')
      res.write('--shinobi\r\n')
      res.write('Content-Type: image/jpeg\r\n')
      res.write('Content-Length: ' + content.length + '\r\n')
      res.write('\r\n')
      res.write(content, 'binary')
      res.write('\r\n')
      if (s.group[req.params.ke] && s.group[req.params.ke].mon[req.params.id]) {
        s.group[req.params.ke].mon[req.params.id].emitter.on('data', contentWriter = (d) => {
          content = d
          res.write(content, 'binary')
        })
        res.on('close', () => {
          s.group[req.params.ke].mon[req.params.id].emitter.removeListener('data', contentWriter)
        })
      } else {
        res.end()
      }
    }, res, req, sql)
  }
})
// embed monitor
app.get(['/:auth/embed/:ke/:id', '/:auth/embed/:ke/:id/:addon'], (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin)
  s.auth(req.params, () => {
    req.sql = 'SELECT * FROM Monitors WHERE ke=? and mid=?'
    req.ar = [req.params.ke, req.params.id]
    sql.query(req.sql, req.ar, (err, r) => {
      if (r && r[0]) { r = r[0] }
      res.render('embed', { data: req.params, baseUrl: req.protocol + '://' + req.hostname, port: config.port, mon: r })
    })
  }, res, req, sql)
})
// Get monitors json
app.get(['/:auth/monitor/:ke', '/:auth/monitor/:ke/:id'], (req, res) => {
  req.ret = { ok: false }
  res.setHeader('Content-Type', 'application/json')
  req.fn = () => {
    req.sql = 'SELECT * FROM Monitors WHERE ke=?'
    req.ar = [req.params.ke]
    if (req.params.id) {
      req.sql += ' and mid=?'
      req.ar.push(req.params.id)
    }
    sql.query(req.sql, req.ar, (err, r) => {
      if (r.length === 1) { r = r[0] }
      res.send(s.s(r, null, 3))
    })
  }
  s.auth(req.params, req.fn, res, req, sql)
})
// Get videos json
app.get(['/:auth/videos/:ke', '/:auth/videos/:ke/:id', '/:auth/videos/:ke/:id'], (req, res) => {
  s.auth(req.params, () => {
    req.sql = 'SELECT * FROM Videos WHERE ke=?'
    req.ar = [req.params.ke]
    if (req.params.id) {
      req.sql += 'and mid=?'
      req.ar.push(req.params.id)
    }
    if (!req.query.limit || req.query.limit === '') { req.query.limit = 100 }
    req.sql += ' ORDER BY `time` DESC LIMIT ' + req.query.limit + ''
    sql.query(req.sql, req.ar, (err, r) => {
      r.forEach((v) => {
        v.href = '/' + req.params.auth + '/videos/' + v.ke + '/' + v.mid + '/' + s.moment_noOffset(v.time) + '.' + v.ext
      })
      res.send(s.s(r, null, 3))
    })
  }, res, req, sql)
})
// Get events json (motion logs)
app.get(['/:auth/events/:ke', '/:auth/events/:ke/:id', '/:auth/events/:ke/:id/:limit', '/:auth/events/:ke/:id/:limit/:start', '/:auth/events/:ke/:id/:limit/:start/:end'], (req, res) => {
  req.ret = { ok: false }
  res.setHeader('Content-Type', 'application/json')
  s.auth(req.params, () => {
    req.sql = 'SELECT * FROM Events WHERE ke=?'
    req.ar = [req.params.ke]
    if (req.params.id) {
      req.sql += ' and mid=?'
      req.ar.push(req.params.id)
    }
    if (req.params.start && req.params.start !== '') {
      req.params.start = req.params.start.replace('T', ' ')
      if (req.params.end && req.params.end !== '') {
        req.params.end = req.params.end.replace('T', ' ')
        req.sql += ' AND `time` >= ? AND `time` <= ?'
        req.ar.push(decodeURIComponent(req.params.start))
        req.ar.push(decodeURIComponent(req.params.end))
      } else {
        req.sql += ' AND `time` >= ?'
        req.ar.push(decodeURIComponent(req.params.start))
      }
    }
    if (!req.params.limit || req.params.limit === '') { req.params.limit = 100 }
    req.sql += ' ORDER BY `time` DESC LIMIT ' + req.params.limit + ''
    sql.query(req.sql, req.ar, (err, r) => {
      if (err) { err.sql = req.sql; return res.send(s.s(err, null, 3)) }
      if (!r) { r = [] }
      r.forEach((v, n) => {
        r[n].details = JSON.parse(v.details)
      })
      res.send(s.s(r, null, 3))
    })
  }, res, req, sql)
})
// Get logs json
app.get(['/:auth/logs/:ke', '/:auth/logs/:ke/:id', '/:auth/logs/:ke/:limit', '/:auth/logs/:ke/:id/:limit'], (req, res) => {
  req.ret = { ok: false }
  res.setHeader('Content-Type', 'application/json')
  s.auth(req.params, () => {
    req.sql = 'SELECT * FROM Logs WHERE ke=?'
    req.ar = [req.params.ke]
    if (req.params.id) {
      req.sql += ' and mid=?'
      req.ar.push(req.params.id)
    }
    if (!req.params.limit || req.params.limit === '') { req.params.limit = 100 }
    req.sql += ' ORDER BY `time` DESC LIMIT ' + req.params.limit + ''
    sql.query(req.sql, req.ar, (err, r) => {
      if (err) { err.sql = req.sql; return res.send(s.s(err, null, 3)) }
      if (!r) { r = [] }
      r.forEach((v, n) => {
        r[n].info = JSON.parse(v.info)
      })
      res.send(s.s(r, null, 3))
    })
  }, res, req, sql)
})
// Get monitors online json
app.get('/:auth/smonitor/:ke', (req, res) => {
  req.ret = { ok: false }
  res.setHeader('Content-Type', 'application/json')
  req.fn = () => {
    sql.query('SELECT * FROM Monitors WHERE ke=?', [req.params.ke], (err, r) => {
      if (r && r[0]) {
        req.ar = []
        r.forEach((v) => {
          if (s.group[req.params.ke] && s.group[req.params.ke].mon[v.mid] && s.group[req.params.ke].mon[v.mid].started === 1) {
            req.ar.push(v)
          }
        })
      } else {
        req.ar = []
      }
      res.send(s.s(req.ar, null, 3))
    })
  }
  s.auth(req.params, req.fn, res, req, sql)
})
// Control monitor mode via HTTP
app.get(['/:auth/monitor/:ke/:mid/:f', '/:auth/monitor/:ke/:mid/:f/:ff', '/:auth/monitor/:ke/:mid/:f/:ff/:fff'], (req, res) => {
  req.ret = { ok: false }
  res.setHeader('Content-Type', 'application/json')
  req.fn = () => {
    if (req.params.f === '') {
      req.ret.msg = 'incomplete request, remove last slash in URL or put acceptable value.'
      res.send(s.s(req.ret, null, 3))
      return
    }
    if (req.params.f !== 'stop' && req.params.f !== 'start' && req.params.f !== 'record') {
      req.ret.msg = 'Mode not recognized.'
      res.send(s.s(req.ret, null, 3))
      return
    }
    sql.query('SELECT * FROM Monitors WHERE ke=? AND mid=?', [req.params.ke, req.params.mid], (err, r) => {
      if (r && r[0]) {
        r = r[0]
        if (r.mode !== req.params.f) {
          r.mode = req.params.f
          s.group[r.ke].mon_conf[r.mid] = r
          s.emitToRoom({ f: 'monitor_edit', mid: r.id, ke: r.ke, mon: r }, 'GRP_' + r.ke)
          s.emitToRoom({ f: 'monitor_edit', mid: r.id, ke: r.ke, mon: r }, 'STR_' + r.ke)
          s.camera('stop', r)
          if (req.params.f !== 'stop') {
            s.camera(req.params.f, r)
          }
          req.ret.cmd_at = s.moment(new Date(), 'YYYY-MM-DD HH:mm:ss')
          req.ret.msg = 'Monitor mode changed to : ' + req.params.f
          req.ret.ok = true
          sql.query('UPDATE Monitors SET mode=? WHERE ke=? AND mid=?', [req.params.f, r.ke, r.mid])
          if (req.params.ff && req.params.f !== 'stop') {
            req.params.ff = parseFloat(req.params.ff)
            clearTimeout(s.group[r.ke].mon[r.mid].trigger_timer)
            switch (req.params.fff) {
              case 'day':
              case 'days':
                req.timeout = req.params.ff * 1000 * 60 * 60 * 24
                break
              case 'hr':
              case 'hour':
              case 'hours':
                req.timeout = req.params.ff * 1000 * 60 * 60
                break
              case 'min':
              case 'minute':
              case 'minutes':
                req.timeout = req.params.ff * 1000 * 60
                break
              default: // seconds
                req.timeout = req.params.ff * 1000
                break
            }
            s.group[r.ke].mon[r.mid].trigger_timer = setTimeout(() => {
              sql.query('UPDATE Monitors SET mode=? WHERE ke=? AND mid=?', ['stop', r.ke, r.mid])
              s.camera('stop', r)
              r.mode = 'stop'
              s.group[r.ke].mon_conf[r.mid] = r
              s.emitToRoom({ f: 'monitor_edit', mid: r.id, ke: r.ke, mon: r }, 'GRP_' + r.ke)
              s.emitToRoom({ f: 'monitor_edit', mid: r.id, ke: r.ke, mon: r }, 'STR_' + r.ke)
            }, req.timeout)
            req.ret.end_at = s.moment(new Date(), 'YYYY-MM-DD HH:mm:ss').add(req.timeout, 'milliseconds')
          }
        } else {
          req.ret.msg = 'Monitor mode is already : ' + req.params.f
        }
      } else {
        req.ret.msg = 'Monitor or Key does not exist.'
      }
      res.send(s.s(req.ret, null, 3))
    })
  }
  s.auth(req.params, req.fn, res, req, sql)
})
    // Get lib files
app.get(['/libs/:f/:f2', '/libs/:f/:f2/:f3'], (req, res) => {
  req.dir = path.join(__dirname, '/web/libs/', req.params.f, '/', req.params.f2)
  if (req.params.f3) { req.dir = req.dir + '/' + req.params.f3 }
  if (fs.existsSync(req.dir)) {
    fs.createReadStream(req.dir).pipe(res)
  } else {
    res.send('File Not Found')
  }
})
// Get video file
app.get('/:auth/videos/:ke/:id/:file', (req, res) => {
  req.fn = () => {
    req.dir = s.dir.videos + req.params.ke + '/' + req.params.id + '/' + req.params.file
    if (fs.existsSync(req.dir)) {
      res.setHeader('content-type', 'video/' + req.params.file.split('.')[1])
      res.sendFile(req.dir)
    } else {
      res.send('File Not Found')
    }
  }
  s.auth(req.params, req.fn, res, req, sql)
})
// modify video file
app.get(['/:auth/videos/:ke/:id/:file/:mode', '/:auth/videos/:ke/:id/:file/:mode/:f'], (req, res) => {
  req.ret = { ok: false }
  res.setHeader('Content-Type', 'application/json')
  s.auth(req.params, () => {
    req.sql = 'SELECT * FROM Videos WHERE ke=? AND mid=? AND time=?'
    req.ar = [req.params.ke, req.params.id, s.nameToTime(req.params.file)]
    sql.query(req.sql, req.ar, (err, r) => {
      if (r && r[0]) {
        r = r[0]
        r.filename = s.moment(r.time) + '.' + r.ext
        switch (req.params.mode) {
          case 'status':
            req.params.f = parseInt(req.params.f)
            if (isNaN(req.params.f) || req.params.f === 0) {
              req.ret.msg = 'Not a valid value.'
            } else {
              req.ret.ok = true
              sql.query('UPDATE Videos SET status=? WHERE ke=? AND mid=? AND time=?', [req.params.f, req.params.ke, req.params.id, s.nameToTime(req.params.file)])
              s.emitToRoom({
                f: 'video_edit',
                status: req.params.f,
                filename: r.filename,
                mid: r.mid,
                ke: r.ke,
                time: s.nameToTime(r.filename),
                end: s.moment(new Date(), 'YYYY-MM-DD HH:mm:ss')
              }, 'GRP_' + r.ke)
            }
            break
          case 'delete':
            req.ret.ok = true
            s.video('delete', r)
            break
          default:
            req.ret.msg = 'Method doesn\'t exist. Check to make sure that the last value of the URL is not blank.'
            break
        }
      } else {
        req.ret.msg = 'No such file'
      }
      res.send(s.s(req.ret, null, 3))
    })
  }, res, req, sql)
})
    // preliminary monitor start
setTimeout(() => {
  sql.query('SELECT * FROM Monitors WHERE mode != "stop"', (err, r) => {
    if (err) { console.log(err) }
    if (r && r[0]) {
      r.forEach((v) => {
        r.ar = {}
        r.ar.id = v.mid
        Object.keys(v).forEach((b) => {
          r.ar[b] = v[b]
        })
        s.camera(v.mode, r.ar)
      })
    }
  })
}, 1500)

try {
  s.cpuUsage = (e) => {
    e(os.loadavg()[0]) // 1 minute load average
  }
  s.ramUsage = () => {
    let totalMem = os.totalmem()
    let usedMem = totalMem - os.freemem()
    return usedMem / totalMem * 100
  }
  setInterval(() => {
    s.cpuUsage((d) => {
      s.emitToRoom({ f: 'os', cpu: d, ram: s.ramUsage() }, 'CPU')
    })
  }, 5000)
} catch (err) { console.log('CPU indicator will not work. Continuing...') }

// check disk space every 20 minutes
s.disk = (x) => {
  exec('echo 3 > /proc/sys/vm/drop_caches')
  df((er, d) => {
    if (er) { clearInterval(s.disk_check) } else { er = { f: 'disk', data: d } }
    s.emitToRoom(er, 'CPU')
  })
}
s.disk_check = setInterval(() => { s.disk() }, 60000 * 20)
s.beat = () => {
  setTimeout(s.beat, 8000)
  io.sockets.emit('ping', { beat: 1 })
}
s.beat()
