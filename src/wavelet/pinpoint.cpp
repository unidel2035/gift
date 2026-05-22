#include "wavelet_codec.h"
#include <cstdio>
using namespace wavelet;

int main() {
    const int N = 128;
    float* ch[4];
    for (int c=0; c<4; c++) ch[c] = new float[N];
    for (int i=0; i<N; i++) {
        ch[0][i] = 55.75f + 0.001f*i;
        ch[1][i] = 37.62f + 0.001f*i;
        ch[2][i] = 100.0f;
        ch[3][i] = 85.0f;
    }

    // Check DWT round-trip on float first
    float test[N];
    for (int i=0; i<N; i++) test[i] = ch[0][i];
    
    float backup[N]; memcpy(backup, test, sizeof(test));
    
    haar_forward_f(test, N);
    haar_inverse_f(test, N);
    
    double max_e = 0;
    for (int i=0; i<N; i++) {
        double e = fabs(backup[i] - test[i]);
        if (e > max_e) max_e = e;
    }
    printf("Float DWT round-trip max error: %.6f\n", max_e);
    
    // Now test full compress/decompress pipeline
    auto comp = Codec::compress(ch, N);
    printf("Compressed: %zu bytes\n", comp.size());
    
    float* rec[4];
    int rec_n = 0;
    Codec::decompress(comp.data(), comp.size(), rec, rec_n);
    printf("Recovered samples: %d\n", rec_n);
    
    max_e = 0;
    for (int c=0; c<4; c++) {
        for (int i=0; i<N; i++) {
            double e = fabs(ch[c][i] - rec[c][i]);
            if (e > max_e) max_e = e;
        }
    }
    printf("Full pipeline max error: %.3f\n", max_e);
    
    // Check first few values
    for (int i=0; i<3; i++) {
        printf("  ch0[%d]: orig=%.3f rec=%.3f\n", i, ch[0][i], rec[0][i]);
    }
    
    for (int c=0; c<4; c++) { delete[] ch[c]; delete[] rec[c]; }
    return 0;
}
