//
//This function tracks the running time between frames.
//it uses a running average method to determine the time over the above
//but varies it's length a bit based on dataChunkLength to reduce
//calls to unshift.
//
function TimeTracker(maxRunningAvgDataCount, dataChunkLength){
  this.resetPulse = false;
  this.pulseOrigin = null;
  this.lastTickStartTime;
  this.averageTickTime = 1000.0 / 60.0;
  this.runningSum = 0.0;
  this.runningCount = 0;
  this.dataPointsAdded = false;
  this.invRunningCount;
  this.maxRunningCount = maxRunningAvgDataCount;
  this.runningChunkSum = 0.0;
  this.numRunningChunkDataPoints = dataChunkLength;
  this.numRunningChunkDataPointsMOne = this.numRunningChunkDataPoints - 1;
  this.invRunningCounts = new Array(this.numRunningChunkDataPoints);
  this.runningDataChunkSum = 0.0;
  this.dataChunkSums = [];
  this.chunkDistance = this.maxRunningCount - this.numRunningChunkDataPoints;
  this.dataChunkIterator = 0;
  var self = this;

  for(let i = 0, dataChunkLength = this.numRunningChunkDataPoints; i < dataChunkLength; i++){
    this.invRunningCounts[i] = 1.0 / (this.chunkDistance + i);
  }

  //Adds on new data points to our set.
  this.addTimeBetweenTicks = function(timeDelta){
    if(timeDelta > 0){
      let avgTickTime = self.averageTickTime;

      //Remove the last one from our collection
      if(self.runningCount < self.chunkDistance){
        self.runningCount += 1;
        self.invRunningCount = 1.0 / self.runningCount;

        if(self.dataChunkIterator === self.numRunningChunkDataPointsMOne){
          let runningChunkSum = self.runningDataChunkSum;
          self.dataChunkSums.push(runningChunkSum);
          self.runningDataChunkSum = 0.0;
        }
      }
      else if(self.dataChunkIterator !== 0){
        self.invRunningCount = self.invRunningCounts[self.dataChunkIterator];

        if(self.dataChunkIterator === self.numRunningChunkDataPointsMOne){
          let runningChunkSum = self.runningDataChunkSum;
          self.dataChunkSums.push(runningChunkSum);
          self.runningDataChunkSum = 0.0;
        }
      }
      else{
        self.invRunningCount = self.invRunningCounts[self.dataChunkIterator];
        self.runningSum -= self.dataChunkSums.unshift();
      }
      self.runningDataChunkSum += timeDelta;
      self.runningSum += timeDelta;

      //Update our iterator
      self.dataChunkIterator += 1;
      self.dataChunkIterator = self.dataChunkIterator % self.numRunningChunkDataPoints;
      self.averageTickTime = self.runningSum * self.invRunningCount;
    }
  }
}
