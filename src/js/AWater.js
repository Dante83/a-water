//Basic skeleton for the overall namespace of the A-Starry-Sky
AWater = {
  AOcean:{
    DefaultData: {},
    Materials: {
      FFTWaves: {},
      Ocean: {}
    },
    Renderers: {},
    LUTlibraries: {},
  },
  setActiveCamera: (camera) => {
      if(AWater.AOcean.OceanGrid !== null){
        AWater.AOcean.OceanGrid.camera = camera;
      }
    },
    getActiveCamera: () => {s
      if(AWater.AOcean.OceanGrid !== null){
        return AWater.AOcean.OceanGrid.camera;
      }
      return false;
    }
};
