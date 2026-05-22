#include <cstdio>
#include <vector>
#include <cstdint>
using namespace std;

struct RLEPair { int16_t value; uint8_t run; };

vector<RLEPair> rle_encode(const int16_t* coeffs, int N) {
    vector<RLEPair> out;
    int zeros = 0;
    for (int i = 0; i < N; i++) {
        if (coeffs[i] == 0) {
            zeros++;
            if (zeros == 255) { out.push_back({0, 255}); zeros = 0; }
        } else {
            if (zeros > 0) { out.push_back({0, (uint8_t)zeros}); zeros = 0; }
            out.push_back({coeffs[i], 0});
        }
    }
    if (zeros > 0) out.push_back({0, (uint8_t)zeros});
    return out;
}

int main() {
    int16_t orig[10] = {0, 0, 5, 0, -3, 0, 0, 7, 0, 0};
    auto rle = rle_encode(orig, 10);
    
    printf("RLE pairs: %zu\n", rle.size());
    for (auto& p : rle) printf("  {val=%d, run=%d}\n", p.value, p.run);
    
    int16_t recovered[10] = {0};
    int idx = 0;
    for (auto& p : rle) {
        if (p.value == 0 && p.run > 0) {
            idx += p.run;
        } else {
            recovered[idx++] = p.value;
        }
    }
    
    int errors = 0;
    for (int i = 0; i < 10; i++) {
        if (orig[i] != recovered[i]) {
            printf("MISMATCH [%d]: orig=%d rec=%d\n", i, orig[i], recovered[i]);
            errors++;
        }
    }
    printf("Errors: %d\n", errors);
}
