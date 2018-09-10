function PerformanceDebugger(){
  this.performanceSets = [];
  this.spotCheckPerformance = function(id, isStart = false){
    let t0;
    if(!isStart){
      t0 = performance.now();
    }
    else if(!this.performanceSets.hasOwnProperty(id)){
      this.performanceSets[id] = {
        id: id,
        totalTimeSum: 0.0,
        lastStartTime: 0.0,
        times: [],
        dataPointCount: 0
      };
    }
    let dataPoint = this.performanceSets[id];

    //Presume we can only have a startTime
    if(isStart){
      t0 = performance.now();
      dataPoint.lastStartTime = t0;
    }
    else{
      let timeDiff = t0 - dataPoint.lastStartTime;
      dataPoint.times.push(timeDiff);
      dataPoint.totalTimeSum += timeDiff;
      dataPoint.dataPointCount += 1;
    }
  }

  this.outputPerformanceResults = function(){
    console.log("In milliseconds...");
    for(performanceSet in this.performanceSets){
      let name = performanceSet;
      let dataPoint = this.performanceSets[name];
      let average = dataPoint.totalTimeSum / dataPoint.dataPointCount;
      let sortedTimes = dataPoint.times.sort();
      let median = sortedTimes[Math.floor(dataPoint.dataPointCount * 0.5)];
      let max = Math.max(...dataPoint.times);
      let min = Math.min(...dataPoint.times);
      console.log(`Performance Set ${name} - (AVG: ${average}, MED: ${median}, MAX: ${max}, MIN: ${min}, TOTAL: ${dataPoint.totalTimeSum})`);
    }
  }
}
