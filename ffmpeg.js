'use strict';
var uuid, Service, Characteristic, StreamController;

var fs = require('fs');
var ip = require('ip');
var spawn = require('child_process').spawn;

module.exports = {
  FFMPEG: FFMPEG
};

function FFMPEG(hap, ffmpegOpt) {
  uuid = hap.uuid;
  Service = hap.Service;
  Characteristic = hap.Characteristic;
  StreamController = hap.StreamController;

  if (!ffmpegOpt.source) {
    throw new Error("Missing source for camera.");
  }

  this.ffmpegSource = ffmpegOpt.source;
  this.ffmpegImageSource = ffmpegOpt.stillImageSource;

  this.services = [];
  this.streamControllers = [];

  this.pendingSessions = {};
  this.ongoingSessions = {};

  var numberOfStreams = ffmpegOpt.maxStreams || 2;
  var videoResolutions = [];
  
  var maxWidth = ffmpegOpt.maxWidth;
  var maxHeight = ffmpegOpt.maxHeight;
  var maxFPS = (ffmpegOpt.maxFPS > 30) ? 30 : ffmpegOpt.maxFPS;

  if (maxWidth >= 320) {
    if (maxHeight >= 240) {
      videoResolutions.push([320, 240, maxFPS]);
      if (maxFPS > 15) {
        videoResolutions.push([320, 240, 15]);
      }
    }

    if (maxHeight >= 180) {
      videoResolutions.push([320, 180, maxFPS]);
      if (maxFPS > 15) {
        videoResolutions.push([320, 180, 15]);
      }
    }
  }

  if (maxWidth >= 480) {
    if (maxHeight >= 360) {
      videoResolutions.push([480, 360, maxFPS]);
    }

    if (maxHeight >= 270) {
      videoResolutions.push([480, 270, maxFPS]);
    }
  }

  if (maxWidth >= 640) {
    if (maxHeight >= 480) {
      videoResolutions.push([640, 480, maxFPS]);
    }

    if (maxHeight >= 360) {
      videoResolutions.push([640, 360, maxFPS]);
    }
  }

  if (maxWidth >= 1280) {
    if (maxHeight >= 960) {
      videoResolutions.push([1280, 960, maxFPS]);
    }

    if (maxHeight >= 720) {
      videoResolutions.push([1280, 720, maxFPS]);
    }
  }

  if (maxWidth >= 1920) {
    if (maxHeight >= 1080) {
      videoResolutions.push([1920, 1080, maxFPS]);
    }
  }

  let options = {
    proxy: false, // Requires RTP/RTCP MUX Proxy
    srtp: true, // Supports SRTP AES_CM_128_HMAC_SHA1_80 encryption
    video: {
      resolutions: videoResolutions,
      codec: {
        profiles: [0, 1, 2], // Enum, please refer StreamController.VideoCodecParamProfileIDTypes
        levels: [0, 1, 2] // Enum, please refer StreamController.VideoCodecParamLevelTypes
      }
    },
    audio: {
      codecs: [
        {
          type: "OPUS", // Audio Codec
          samplerate: 24 // 8, 16, 24 KHz
        },
        {
          type: "AAC-eld",
          samplerate: 16
        }
      ]
    }
  }

  this.createCameraControlService();
  this._createStreamControllers(numberOfStreams, options); 
}

FFMPEG.prototype.handleCloseConnection = function(connectionID) {
  this.streamControllers.forEach(function(controller) {
    controller.handleCloseConnection(connectionID);
  });
}

FFMPEG.prototype.handleSnapshotRequest = function(request, callback) {
  let resolution = request.width + 'x' + request.height;
  var imageSource = this.ffmpegImageSource !== undefined ? this.ffmpegImageSource : this.ffmpegSource;
  let ffmpeg = spawn('ffmpeg', (imageSource + ' -t 1 -s '+ resolution + ' -f image2 -').split(' '), {env: process.env});
  var imageBuffer = Buffer(0);

  ffmpeg.stdout.on('data', function(data) {
    imageBuffer = Buffer.concat([imageBuffer, data]);
  });
  ffmpeg.on('close', function(code) {
    callback(undefined, imageBuffer);
  });
}

FFMPEG.prototype.prepareStream = function(request, callback) {
  var sessionInfo = {};

  let sessionID = request["sessionID"];
  let targetAddress = request["targetAddress"];

  sessionInfo["address"] = targetAddress;

  var response = {};

  let videoInfo = request["video"];
  if (videoInfo) {
    let targetPort = videoInfo["port"];
    let srtp_key = videoInfo["srtp_key"];
    let srtp_salt = videoInfo["srtp_salt"];

    let videoResp = {
      port: targetPort,
      ssrc: 1,
      srtp_key: srtp_key,
      srtp_salt: srtp_salt
    };

    response["video"] = videoResp;

    sessionInfo["video_port"] = targetPort;
    sessionInfo["video_srtp"] = Buffer.concat([srtp_key, srtp_salt]);
    sessionInfo["video_ssrc"] = 1; 
  }

  let audioInfo = request["audio"];
  if (audioInfo) {
    let targetPort = audioInfo["port"];
    let srtp_key = audioInfo["srtp_key"];
    let srtp_salt = audioInfo["srtp_salt"];

    let audioResp = {
      port: targetPort,
      ssrc: 1,
      srtp_key: srtp_key,
      srtp_salt: srtp_salt
    };

    response["audio"] = audioResp;

    sessionInfo["audio_port"] = targetPort;
    sessionInfo["audio_srtp"] = Buffer.concat([srtp_key, srtp_salt]);
    sessionInfo["audio_ssrc"] = 1; 
  }

  let currentAddress = ip.address();
  var addressResp = {
    address: currentAddress
  };

  if (ip.isV4Format(currentAddress)) {
    addressResp["type"] = "v4";
  } else {
    addressResp["type"] = "v6";
  }

  response["address"] = addressResp;
  this.pendingSessions[uuid.unparse(sessionID)] = sessionInfo;

  callback(response);
}

FFMPEG.prototype.handleStreamRequest = function(request) {
  var sessionID = request["sessionID"];
  var requestType = request["type"];
  if (sessionID) {
    let sessionIdentifier = uuid.unparse(sessionID);

    if (requestType == "start") {
      var sessionInfo = this.pendingSessions[sessionIdentifier];
      if (sessionInfo) {
        var width = 1280;
        var height = 720;
        var fps = 30;
        var bitrate = 300;

        let videoInfo = request["video"];
        if (videoInfo) {
          width = videoInfo["width"];
          height = videoInfo["height"];

          let expectedFPS = videoInfo["fps"];
          if (expectedFPS < fps) {
            fps = expectedFPS;
          }

          bitrate = videoInfo["max_bit_rate"];
        }

        let targetAddress = sessionInfo["address"];
        let targetVideoPort = sessionInfo["video_port"];
        let videoKey = sessionInfo["video_srtp"];

        let ffmpegCommand = this.ffmpegSource + ' -threads 0 -vcodec libx264 -an -pix_fmt yuv420p -r '+ fps +' -f rawvideo -tune zerolatency -vf scale='+ width +':'+ height +' -b:v '+ bitrate +'k -bufsize '+ bitrate +'k -payload_type 99 -ssrc 1 -f rtp -srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params '+videoKey.toString('base64')+' srtp://'+targetAddress+':'+targetVideoPort+'?rtcpport='+targetVideoPort+'&localrtcpport='+targetVideoPort+'&pkt_size=1378';
        console.log(ffmpegCommand);
        let ffmpeg = spawn('ffmpeg', ffmpegCommand.split(' '), {env: process.env});
        this.ongoingSessions[sessionIdentifier] = ffmpeg;
      }

      delete this.pendingSessions[sessionIdentifier];
    } else if (requestType == "stop") {
      var ffmpegProcess = this.ongoingSessions[sessionIdentifier];
      if (ffmpegProcess) {
        ffmpegProcess.kill('SIGKILL');
      }

      delete this.ongoingSessions[sessionIdentifier];
    }
  }
}

FFMPEG.prototype.createCameraControlService = function() {
  var controlService = new Service.CameraControl();

  this.services.push(controlService);
}

// Private

FFMPEG.prototype._createStreamControllers = function(maxStreams, options) {
  let self = this;

  for (var i = 0; i < maxStreams; i++) {
    var streamController = new StreamController(i, options, self);

    self.services.push(streamController.service);
    self.streamControllers.push(streamController);
  }
}