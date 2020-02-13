#include "WaterState.h"
#include <stdio.h>
#include <emscripten/emscripten.h>
#include <string>

using namespace std;

WaterState::WaterState(){
  //Do Nothing
}

WaterState* waterState;

extern "C" {
  int main();
  void modifiyStateTest(float* inputArrayPtr, float* outputArrayPtr, int numberOfElements);
}

EMSCRIPTEN_KEEPALIVE void modifiyStateTest(float* inputArrayPtr, float* outputArrayPtr, int numberOfElements){
  printf("STARTING!");
  for(int i = 0; i < numberOfElements; ++i){
    printf("%F", inputArrayPtr[i]);
    outputArrayPtr[i] = inputArrayPtr[i] + 1.0;
  }
  printf("FINISHED!");
}

EMSCRIPTEN_KEEPALIVE void initializeParticleSetMemory(){

}

int main(){
  printf("Hello world!\n");
  return 0;
}
