#include <cstdio>
#include <cmath>

inline void haar_forward_f(float* signal, int N) {
    int n = N;
    while (n > 1) {
        int half = n / 2;
        for (int i = 0; i < half; i++) {
            float a = signal[2 * i];
            float b = signal[2 * i + 1];
            signal[i]       = (a + b) * 0.5f;
            signal[half + i] = (a - b) * 0.5f;
        }
        n = half;
    }
}

inline void haar_inverse_f(float* signal, int N) {
    int n = 2;
    while (n <= N) {
        int half = n / 2;
        for (int i = 0; i < half; i++) {
            float avg  = signal[i];
            float diff = signal[half + i];
            signal[2 * i]     = avg + diff;
            signal[2 * i + 1] = avg - diff;
        }
        n *= 2;
    }
}

int main() {
    const int N = 8; // small for debugging
    float test[N];
    for (int i=0; i<N; i++) test[i] = 55.75f + 0.001f * i;
    
    printf("Original: "); for(int i=0;i<N;i++) printf("%.4f ", test[i]); printf("\n");
    
    float backup[N]; 
    for(int i=0; i<N; i++) backup[i] = test[i];
    
    haar_forward_f(test, N);
    printf("After FWD: "); for(int i=0;i<N;i++) printf("%.4f ", test[i]); printf("\n");
    
    haar_inverse_f(test, N);
    printf("After INV: "); for(int i=0;i<N;i++) printf("%.4f ", test[i]); printf("\n");
    
    double max_e = 0;
    for (int i=0; i<N; i++) {
        double e = fabs(backup[i] - test[i]);
        if (e > max_e) max_e = e;
    }
    printf("Max error: %.6f\n", max_e);
    
    return 0;
}
