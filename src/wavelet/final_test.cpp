#include "wavelet_codec.h"
#include <cstdio>
using namespace wavelet;

int main() {
    const int N = 128, CH = 4;
    float* ch[CH];
    for (int c=0; c<CH; c++) { ch[c] = new float[N]; }
    for (int i=0; i<N; i++) {
        ch[0][i] = 55.75f + 0.001f * i;
        ch[1][i] = 37.62f + 0.001f * i;
        ch[2][i] = 100.0f + 20.0f * sin(0.05f * i);
        ch[3][i] = 85.0f - 0.05f * i;
    }

    // Test channel 0 separately through DWT
    float fwd[N];
    for (int i=0; i<N; i++) fwd[i] = ch[0][i];
    
    float orig[N]; 
    for(int i=0;i<N;i++) orig[i]=fwd[i];
    
    haar_forward_f(fwd, N);
    
    // Convert to int16, threshold, convert back
    int16_t ibuf[N];
    for (int i=0; i<N; i++) ibuf[i] = (int16_t)std::round(fwd[i] * 100.0f);
    threshold_abs<int16_t, N>(ibuf, 3);
    printf("After threshold: non-zero coeffs = %d\n", [&]{int nz=0;for(int i=0;i<N;i++)if(ibuf[i]!=0)nz++;return nz;}());
    
    // Convert back to float
    float fbuf[N];
    for (int i=0; i<N; i++) fbuf[i] = ibuf[i] / 100.0f;
    
    haar_inverse_f(fbuf, N);
    
    double max_e = 0;
    for (int i=0; i<N; i++) {
        double e = fabs(orig[i] - fbuf[i]);
        if (e > max_e) max_e = e;
    }
    printf("Float→int16→threshold→inv max error: %.3f\n", max_e);
    
    // Now full pipeline
    auto comp = Codec::compress(ch, N);
    printf("Compressed: %zu bytes (×%.1f)\n", comp.size(), (float)(N*CH*4)/(float)comp.size());
    
    float* rec[CH] = {0};
    int rec_n = 0;
    Codec::decompress(comp.data(), comp.size(), rec, rec_n);
    
    max_e = 0;
    for (int c=0; c<CH && rec[c]; c++) {
        for (int i=0; i<N && i<rec_n; i++) {
            double e = fabs(ch[c][i] - rec[c][i]);
            if (e > max_e) max_e = e;
        }
    }
    printf("Full pipeline max error: %.3f\n", max_e);
    
    // Show sample values
    for (int i=0; i<3; i++) printf("  ch0[%d]: orig=%.3f rec=%.3f\n", i, ch[0][i], rec[0]?rec[0][i]:0);
    for (int i=124; i<127; i++) printf("  ch0[%d]: orig=%.3f rec=%.3f\n", i, ch[0][i], rec[0]?rec[0][i]:0);
    
    for (int c=0;c<CH;c++){delete[]ch[c];if(rec[c])delete[]rec[c];}
    return 0;
}
