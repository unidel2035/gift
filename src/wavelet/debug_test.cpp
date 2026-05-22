#include "wavelet_codec.h"
#include <cstdio>
#include <cmath>
using namespace wavelet;

int main() {
    const int N = 128;
    float* ch[4];
    for (int c = 0; c < 4; c++) ch[c] = new float[N];
    for (int i = 0; i < N; i++) {
        ch[0][i] = 55.75f + 0.001f * i;
        ch[1][i] = 37.62f + 0.001f * i;
        ch[2][i] = 100.0f + 20.0f * sin(0.05f * i);
        ch[3][i] = 85.0f - 0.05f * i;
    }

    // Test forward+inverse on raw coefficients
    int16_t test[N];
    for (int i = 0; i < N; i++) test[i] = (int16_t)(ch[0][i] * 100.0f);
    
    int16_t orig[N]; memcpy(orig, test, sizeof(test));
    
    haar_forward<int16_t, N>(test);
    printf("After forward: DC=%d, max=%d\n", test[0], test[1]);
    
    threshold_abs<int16_t, N>(test, 3);
    printf("After threshold: zeros=%d\n", [&]{int z=0;for(int i=0;i<N;i++)if(test[i]==0)z++;return z;}());
    
    // RLE encode + decode
    auto rle = rle_encode<N-1>(test + 1);
    printf("RLE pairs: %zu\n", rle.size());
    
    int16_t recovered[N] = {0};
    recovered[0] = test[0]; // DC
    int idx = 1;
    for (auto& p : rle) {
        if (p.value == 0 && p.run > 0) idx += p.run;
        else recovered[idx++] = p.value;
    }
    
    haar_inverse<int16_t, N>(recovered);
    
    double max_err = 0;
    for (int i = 0; i < N; i++) {
        double err = std::abs(orig[i] - recovered[i]) / 100.0;
        if (err > max_err) max_err = err;
    }
    
    printf("Max error: %.3f\n", max_err);
    
    for (int c=0;c<4;c++) delete[] ch[c];
    return 0;
}
