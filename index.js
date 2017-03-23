var FFMPEG = require('./ffmpeg').FFMPEG;

"use strict";

var Characteristic, Service;



module.exports = function(homebridge) {
   Accessory = homebridge.platformAccessory;
  hap = homebridge.hap;
  UUIDGen = homebridge.hap.uuid;
  Characteristic = homebridge.hap.Characteristic;
  Service = homebridge.hap.Service;

  homebridge.registerPlatform("homebridge-camera2-ffmpeg", "Camera2-ffmpeg", ffmpegPform, true);
}





function ffmpegPform(log, config) {
  var self = this;

  self.log = log;
  self.config = config || {};

//   if (api) {
//     self.api = api;
// 
//     if (api.version < 2.1) {
//       throw new Error("Unexpected API version.");
//     }
//   }
}




ffmpegPform.prototype.accessories = function(callback) {

	var self = this;
	var configuredAccessories = [];

	if (self.config.cameras) {

		var cameras = self.config.cameras;
		cameras.forEach(function(cameraConfig) {
			  var cameraName = cameraConfig.name;
			  self.log("Camera found : %s" + cameraName);
			  var videoConfig = cameraConfig.videoConfig;

			  if (!cameraName || !videoConfig) {
				self.log("Missing parameters.");
				return;
			  }

//		      var uuid = UUIDGen.generate(cameraName);
//		      var cameraAccessory = new Accessory(cameraName, uuid, hap.Accessory.Categories.CAMERA);
			  var cameraAccessory = new ffmpegAccessory(self.log, cameraConfig.config, cameraName);
			  var cameraSource = new FFMPEG(hap, videoConfig);
			  cameraSource.name = cameraName;
			  cameraAccessory.configureCameraSource(cameraSource);
			  configuredAccessories.push(cameraAccessory);
		}); 
	}
	else {
		self.log('No config for platform');
	}
  
    callback(configuredAccessories);
}


function ffmpegAccessory(log, config, name) {

// 	var uuid = UUIDGen.generate(name);
// 	this.accessory = new Accessory(name, uuid, hap.Accessory.Categories.CAMERA);
	
	this.log = log;
	this.config = config;
	this.name = name;
	this.catergory = hap.Accessory.Categories.CAMERA;
	
	this.reachability = true;

}



ffmpegAccessory.prototype.identify = function (callback) {

  this.log('[' + this.name + '] Identify requested!');
  callback(null); // success

}


ffmpegAccessory.prototype.getServices = function () {

  this.informationService = new Service.AccessoryInformation();

  this.informationService
	.setCharacteristic(Characteristic.Manufacturer, 'FFMPEG')
	.setCharacteristic(Characteristic.SerialNumber, 'Platform')
	.setCharacteristic(Characteristic.FirmwareRevision, 'v1.0')
	.setCharacteristic(Characteristic.Model, 'Camera');
	return [this.informationService];
}


// ffmpegPlatform.prototype.configureAccessory = function(accessory) {
//   // Won't be invoked
// }