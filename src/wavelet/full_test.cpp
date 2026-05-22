#include "wavelet_codec.h"
#include <cstdio>
using namespace wavelet;

int main() {
    const int N = 128, CH = 4;
    float* ch[CH];
    for (int c=0; c<CH; c++) { ch[c] = new float[N]; for(int i=0;i<N;i++) ch[c][i]=0.0f; }
    
    // Simple test: constant values
    ch[0][0]=55.75f; ch[1][0]=37.62f; ch[2][0]=100.0f; ch[3][0]=85.0f;
    
    printf("=== Byte-level debug ===\n");
    auto comp = Codec::compress(ch, 8); // just 8 samples for debugging
    printf("Compressed: %zu bytes\n", comp.size());
    printf("Header: ");
    for (size_t i=0; i<comp.size() && i<20; i++) printf("%02x ", comp[i]);
    printf("\n");
    
    // Decode
    float* rec[CH] = {0};
    int rec_n = 0;
    Codec::decompress(comp.data(), comp.size(), rec, rec_n);
    printf("Recovered samples: %d\n", rec_n);
    
    if (rec[0]) {
        for (int i=0; i<8; i++) printf("  ch0[%d]: orig=%.3f rec=%.3f\n", i, ch[0][i], rec[0][i]);
    }
    
    for (int c=0; c<CH; c++) { delete[] ch[c]; if(rec[c]) delete[] rec[c]; }
    return 0;
}
