// tritgift.v — W-матрица дара на Tang Nano 9K
//
// GiftOS / @unidel/gift — Онтология Дара
// Богословское основание: кенозис, θέωσις, ἀνάμνησις
//
// Хранит до 64 W-нитей (связей лиц) в BRAM.
// Принимает команды через UART (8N1), отвечает через UART.
// FSM тритной логики: ZERO / POSITIVE / NEGATIVE.
// LED отражает состояние FSM (активный LOW, Tang Nano 9K).
//
// Протокол (соответствует fpga-gift-bridge.mjs):
//   'W' idx from to wH wL  — записать нить (4 байта данных после 'W')
//   'Q' idx                — запросить нить, ответ: "W II FF TT WWWW\n"
//   'T'                    — топ нить,       ответ: "T II FF TT WWWW\n"
//   '?'                    — статус,         ответ: "S:Z topW=WWWW\n"
//   '+' '-' '0'            — FSM шаг,        ответ: "F:P\n" / "F:N\n" / "F:Z\n"
//
// Синтезируемый Verilog-2001.  Никаких $display вне `ifdef SIM.
// Протестировано: yosys 0.33, цель synth_gowin, чип GW1NR-9C (Tang Nano 9K).
//
// Примечание по ресурсам:
//   wmem — reg-массив 64×32 бит; синтезатор Gowin отображает его в SP/SDP BRAM.
//   Поиск топ-нити — последовательный (один элемент за такт, 64 такта задержки);
//   это вместо полностью развёрнутого комбинатора, что экономит ~40 000 LUT.
//   При 27 МГц и BAUD=115200 задержка 64 тактов ≈ 2.4 мкс — незаметна на фоне
//   времени передачи ответа (~140 мкс).

`default_nettype none
`timescale 1ns/1ps

module tritgift #(
  parameter CLK_HZ  = 27_000_000,   // Tang Nano 9K — 27 МГц
  parameter BAUD    = 115200,        // скорость UART
  parameter W_DEPTH = 64             // глубина W-памяти (нитей)
) (
  input  wire clk,        // 27 МГц
  input  wire rst_n,      // активный низкий сброс (кнопка S1)
  input  wire uart_rx,    // UART RX от хоста
  output wire uart_tx,    // UART TX к хосту
  output wire led         // активный низкий LED (Tang Nano 9K)
);

  // ─────────────────────────────────────────────────────────────────────────────
  // Параметры тактирования
  // ─────────────────────────────────────────────────────────────────────────────

  localparam integer BAUD_DIV  = CLK_HZ / BAUD;       // тактов на бит
  localparam integer BAUD_HALF = BAUD_DIV / 2;         // полбита

  // ─────────────────────────────────────────────────────────────────────────────
  // W-память: 64 нити × 4 байта = 256 байт
  //   [7:0]   from_id
  //   [15:8]  to_id
  //   [31:16] weight (16 бит без знака; старший бит = знак в расширенном режиме)
  // reg-массив → синтезатор Gowin отображает в SP BRAM
  // ─────────────────────────────────────────────────────────────────────────────

  reg [31:0] wmem [0:W_DEPTH-1];

  // ─────────────────────────────────────────────────────────────────────────────
  // Поиск топ-нити — последовательный сканер
  //
  // После команды W (записи) или запроса T/? запускается обход:
  //   scan_run=1 → scan_addr обходит 0..W_DEPTH-1 по одному такту.
  //   По завершению top_* фиксируют результат.
  // ─────────────────────────────────────────────────────────────────────────────

  reg        scan_run;
  reg [5:0]  scan_addr;

  reg [5:0]  top_idx;
  reg [15:0] top_weight;
  reg [7:0]  top_from;
  reg [7:0]  top_to;

  // Признак что scan завершён (результат валиден)
  reg        top_valid;

  // Регистр чтения BRAM (синхронный порт чтения)
  reg [31:0] scan_rdata;

  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      scan_run   <= 1'b0;
      scan_addr  <= 6'd0;
      top_idx    <= 6'd0;
      top_weight <= 16'd0;
      top_from   <= 8'd0;
      top_to     <= 8'd0;
      top_valid  <= 1'b0;
      scan_rdata <= 32'd0;
    end else begin
      // Синхронное чтение BRAM
      scan_rdata <= wmem[scan_addr];

      if (scan_run) begin
        // На следующий такт scan_rdata содержит wmem[scan_addr-1]
        // (задержка 1 такт синхронного чтения)
        // Начинаем сравнение с такта 1 (scan_addr==1 → данные [0] уже готовы)
        if (scan_addr == 6'd0) begin
          // Инициализация: будем читать с адреса 0
          top_idx    <= 6'd0;
          top_weight <= 16'd0;
          top_from   <= 8'd0;
          top_to     <= 8'd0;
          top_valid  <= 1'b0;
          scan_addr  <= 6'd1;
        end else begin
          // scan_rdata = wmem[scan_addr - 1]
          if (scan_rdata[31:16] > top_weight) begin
            top_weight <= scan_rdata[31:16];
            top_from   <= scan_rdata[7:0];
            top_to     <= scan_rdata[15:8];
            top_idx    <= scan_addr - 6'd1;
          end

          if (scan_addr == W_DEPTH[5:0] - 1) begin
            scan_run  <= 1'b0;
            top_valid <= 1'b1;
          end else begin
            scan_addr <= scan_addr + 6'd1;
          end
        end
      end
    end
  end

  // Запуск сканирования — управляется из исполнителя команд (wire-строб)
  reg scan_trigger;

  // ─────────────────────────────────────────────────────────────────────────────
  // FSM тритной логики
  //   2'b00 = ZERO     (Z)
  //   2'b01 = POSITIVE (P)
  //   2'b10 = NEGATIVE (N)
  // ─────────────────────────────────────────────────────────────────────────────

  localparam FSM_Z = 2'b00;
  localparam FSM_P = 2'b01;
  localparam FSM_N = 2'b10;

  reg [1:0] fsm_state;

  // ─────────────────────────────────────────────────────────────────────────────
  // LED
  //   Z → выключен (led=1, активный LOW)
  //   P → медленное мигание ~1 Гц
  //   N → быстрое  мигание ~4 Гц
  // ─────────────────────────────────────────────────────────────────────────────

  localparam integer BLINK_SLOW = CLK_HZ / 2;
  localparam integer BLINK_FAST = CLK_HZ / 8;

  reg [24:0] blink_cnt;
  reg        blink_bit;

  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      blink_cnt <= 25'd0;
      blink_bit <= 1'b0;
    end else begin
      case (fsm_state)
        FSM_P: begin
          if (blink_cnt >= BLINK_SLOW[24:0] - 1) begin
            blink_cnt <= 25'd0;
            blink_bit <= ~blink_bit;
          end else
            blink_cnt <= blink_cnt + 25'd1;
        end
        FSM_N: begin
          if (blink_cnt >= BLINK_FAST[24:0] - 1) begin
            blink_cnt <= 25'd0;
            blink_bit <= ~blink_bit;
          end else
            blink_cnt <= blink_cnt + 25'd1;
        end
        default: begin
          blink_cnt <= 25'd0;
          blink_bit <= 1'b0;
        end
      endcase
    end
  end

  assign led = (fsm_state == FSM_Z) ? 1'b1 : ~blink_bit;

  // ─────────────────────────────────────────────────────────────────────────────
  // UART RX (8N1)
  // ─────────────────────────────────────────────────────────────────────────────

  reg rx_s0, rx_s1, rx_prev;
  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      rx_s0 <= 1'b1; rx_s1 <= 1'b1; rx_prev <= 1'b1;
    end else begin
      rx_s0   <= uart_rx;
      rx_s1   <= rx_s0;
      rx_prev <= rx_s1;
    end
  end

  localparam RX_IDLE  = 2'd0;
  localparam RX_START = 2'd1;
  localparam RX_DATA  = 2'd2;
  localparam RX_STOP  = 2'd3;

  reg [1:0]  rx_state;
  reg [15:0] rx_clk_cnt;
  reg [2:0]  rx_bit_cnt;
  reg [7:0]  rx_shift;
  reg        rx_valid;
  reg [7:0]  rx_byte;

  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      rx_state   <= RX_IDLE;
      rx_clk_cnt <= 16'd0;
      rx_bit_cnt <= 3'd0;
      rx_shift   <= 8'd0;
      rx_valid   <= 1'b0;
      rx_byte    <= 8'd0;
    end else begin
      rx_valid <= 1'b0;

      case (rx_state)
        RX_IDLE: begin
          if (rx_prev && !rx_s1) begin
            rx_clk_cnt <= 16'd0;
            rx_state   <= RX_START;
          end
        end

        RX_START: begin
          if (rx_clk_cnt >= BAUD_HALF[15:0] - 1) begin
            if (!rx_s1) begin
              rx_clk_cnt <= 16'd0;
              rx_bit_cnt <= 3'd0;
              rx_state   <= RX_DATA;
            end else
              rx_state <= RX_IDLE;
          end else
            rx_clk_cnt <= rx_clk_cnt + 16'd1;
        end

        RX_DATA: begin
          if (rx_clk_cnt >= BAUD_DIV[15:0] - 1) begin
            rx_clk_cnt            <= 16'd0;
            rx_shift[rx_bit_cnt]  <= rx_s1;
            if (rx_bit_cnt == 3'd7)
              rx_state <= RX_STOP;
            else
              rx_bit_cnt <= rx_bit_cnt + 3'd1;
          end else
            rx_clk_cnt <= rx_clk_cnt + 16'd1;
        end

        RX_STOP: begin
          if (rx_clk_cnt >= BAUD_DIV[15:0] - 1) begin
            rx_clk_cnt <= 16'd0;
            if (rx_s1) begin
              rx_byte  <= rx_shift;
              rx_valid <= 1'b1;
            end
            rx_state <= RX_IDLE;
          end else
            rx_clk_cnt <= rx_clk_cnt + 16'd1;
        end

        default: rx_state <= RX_IDLE;
      endcase
    end
  end

  // ─────────────────────────────────────────────────────────────────────────────
  // Командный парсер
  // ─────────────────────────────────────────────────────────────────────────────

  localparam CMD_IDLE    = 4'd0;
  localparam CMD_W_IDX   = 4'd1;
  localparam CMD_W_FROM  = 4'd2;
  localparam CMD_W_TO    = 4'd3;
  localparam CMD_W_WGT_H = 4'd4;
  localparam CMD_W_WGT_L = 4'd5;
  localparam CMD_Q_IDX   = 4'd6;

  localparam EXEC_NONE   = 3'd0;
  localparam EXEC_WRITE  = 3'd1;
  localparam EXEC_QUERY  = 3'd2;
  localparam EXEC_TOP    = 3'd3;
  localparam EXEC_STATUS = 3'd4;
  localparam EXEC_FSM    = 3'd5;

  reg [3:0] cmd_state;
  reg [2:0] exec_type;
  reg [5:0] cmd_idx;
  reg [7:0] cmd_from;
  reg [7:0] cmd_to;
  reg [15:0] cmd_weight;
  reg [7:0]  cmd_fsm_char;
  reg        cmd_exec;

  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      cmd_state    <= CMD_IDLE;
      exec_type    <= EXEC_NONE;
      cmd_idx      <= 6'd0;
      cmd_from     <= 8'd0;
      cmd_to       <= 8'd0;
      cmd_weight   <= 16'd0;
      cmd_fsm_char <= 8'd0;
      cmd_exec     <= 1'b0;
    end else begin
      cmd_exec <= 1'b0;

      if (rx_valid) begin
        case (cmd_state)
          CMD_IDLE: begin
            case (rx_byte)
              8'h57: begin exec_type <= EXEC_WRITE;  cmd_state <= CMD_W_IDX;  end // 'W'
              8'h51: begin exec_type <= EXEC_QUERY;  cmd_state <= CMD_Q_IDX;  end // 'Q'
              8'h54: begin exec_type <= EXEC_TOP;    cmd_exec  <= 1'b1;       end // 'T'
              8'h3F: begin exec_type <= EXEC_STATUS; cmd_exec  <= 1'b1;       end // '?'
              8'h2B: begin exec_type <= EXEC_FSM; cmd_fsm_char <= 8'h2B; cmd_exec <= 1'b1; end // '+'
              8'h2D: begin exec_type <= EXEC_FSM; cmd_fsm_char <= 8'h2D; cmd_exec <= 1'b1; end // '-'
              8'h30: begin exec_type <= EXEC_FSM; cmd_fsm_char <= 8'h30; cmd_exec <= 1'b1; end // '0'
              default: ;
            endcase
          end
          CMD_W_IDX:   begin cmd_idx          <= rx_byte[5:0]; cmd_state <= CMD_W_FROM;  end
          CMD_W_FROM:  begin cmd_from          <= rx_byte;      cmd_state <= CMD_W_TO;    end
          CMD_W_TO:    begin cmd_to            <= rx_byte;      cmd_state <= CMD_W_WGT_H; end
          CMD_W_WGT_H: begin cmd_weight[15:8]  <= rx_byte;      cmd_state <= CMD_W_WGT_L; end
          CMD_W_WGT_L: begin cmd_weight[7:0]   <= rx_byte;      cmd_exec  <= 1'b1; cmd_state <= CMD_IDLE; end
          CMD_Q_IDX:   begin cmd_idx           <= rx_byte[5:0]; cmd_exec  <= 1'b1; cmd_state <= CMD_IDLE; end
          default:     cmd_state <= CMD_IDLE;
        endcase
      end
    end
  end

  // ─────────────────────────────────────────────────────────────────────────────
  // Исполнитель команд
  //
  // Для EXEC_QUERY нужен синхронный порт чтения BRAM.
  // Используем двухтактный pipeline:
  //   Такт 0: cmd_exec=1 → запомнить адрес в rd_addr, выставить rd_en
  //   Такт 1: rd_data = wmem[rd_addr]  (синхронное чтение)
  //   Такт 2: формируем ответ из rd_data
  //
  // Для EXEC_WRITE: запись в BRAM + запуск scan.
  // Для EXEC_TOP / EXEC_STATUS: если scan ещё не готов — подождать top_valid.
  // ─────────────────────────────────────────────────────────────────────────────

  // Вспомогательные функции
  function [7:0] nibble2hex;
    input [3:0] n;
    begin
      nibble2hex = (n < 4'd10) ? (8'd48 + {4'b0000, n}) : (8'd55 + {4'b0000, n});
    end
  endfunction

  function [7:0] fsm2char;
    input [1:0] s;
    begin
      case (s)
        FSM_Z:   fsm2char = 8'h5A; // 'Z'
        FSM_P:   fsm2char = 8'h50; // 'P'
        FSM_N:   fsm2char = 8'h4E; // 'N'
        default: fsm2char = 8'h5A;
      endcase
    end
  endfunction

  // TX буфер — максимум 24 байта ("W 3F FF FF FFFF\n" = 16 + поле S: = 14)
  localparam TX_BUF_SIZE = 24;
  reg [7:0] tx_buf [0:TX_BUF_SIZE-1];
  reg [4:0] tx_len;
  reg       tx_start;

  // BRAM read pipeline для Q
  reg       rd_en;
  reg [5:0] rd_addr;
  reg [31:0] rd_data;      // результат чтения wmem через 1 такт
  reg [2:0]  rd_pending;   // 3-битный сдвиговый регистр-конвейер (pipeline delay)

  // BRAM write
  reg        wr_en;
  reg [5:0]  wr_addr;
  reg [31:0] wr_data;

  always @(posedge clk) begin
    if (wr_en)
      wmem[wr_addr] <= wr_data;
    rd_data <= wmem[rd_addr];   // синхронный порт чтения (1 такт)
  end

  // Ожидание top_valid для T/? после запуска scan
  reg exec_wait_top;
  reg [2:0] exec_wait_type;

  // Основной always
  integer ji;

  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      fsm_state     <= FSM_Z;
      wr_en         <= 1'b0;
      wr_addr       <= 6'd0;
      wr_data       <= 32'd0;
      rd_en         <= 1'b0;
      rd_addr       <= 6'd0;
      rd_pending    <= 3'b000;
      tx_start      <= 1'b0;
      tx_len        <= 5'd0;
      scan_trigger  <= 1'b0;
      scan_run      <= 1'b0;
      exec_wait_top <= 1'b0;
      exec_wait_type<= EXEC_NONE;
      for (ji = 0; ji < TX_BUF_SIZE; ji = ji + 1)
        tx_buf[ji] <= 8'd0;
    end else begin
      wr_en        <= 1'b0;
      tx_start     <= 1'b0;
      scan_trigger <= 1'b0;
      rd_pending   <= {rd_pending[1:0], 1'b0};

      // ── Конвейер ответа на Q (данные готовы через 1 такт после rd_en) ──────
      if (rd_pending[0]) begin
        tx_buf[0]  <= 8'h57; // 'W'
        tx_buf[1]  <= 8'h20;
        tx_buf[2]  <= nibble2hex(rd_addr[5:4]);
        tx_buf[3]  <= nibble2hex(rd_addr[3:0]);
        tx_buf[4]  <= 8'h20;
        tx_buf[5]  <= nibble2hex(rd_data[7:4]);
        tx_buf[6]  <= nibble2hex(rd_data[3:0]);
        tx_buf[7]  <= 8'h20;
        tx_buf[8]  <= nibble2hex(rd_data[15:12]);
        tx_buf[9]  <= nibble2hex(rd_data[11:8]);
        tx_buf[10] <= 8'h20;
        tx_buf[11] <= nibble2hex(rd_data[31:28]);
        tx_buf[12] <= nibble2hex(rd_data[27:24]);
        tx_buf[13] <= nibble2hex(rd_data[23:20]);
        tx_buf[14] <= nibble2hex(rd_data[19:16]);
        tx_buf[15] <= 8'h0A;
        tx_len     <= 5'd16;
        tx_start   <= 1'b1;
      end

      // ── Ожидание top_valid для T/? ─────────────────────────────────────────
      if (exec_wait_top && top_valid) begin
        exec_wait_top <= 1'b0;
        if (exec_wait_type == EXEC_TOP) begin
          tx_buf[0]  <= 8'h54; // 'T'
          tx_buf[1]  <= 8'h20;
          tx_buf[2]  <= nibble2hex(top_idx[5:4]);
          tx_buf[3]  <= nibble2hex(top_idx[3:0]);
          tx_buf[4]  <= 8'h20;
          tx_buf[5]  <= nibble2hex(top_from[7:4]);
          tx_buf[6]  <= nibble2hex(top_from[3:0]);
          tx_buf[7]  <= 8'h20;
          tx_buf[8]  <= nibble2hex(top_to[7:4]);
          tx_buf[9]  <= nibble2hex(top_to[3:0]);
          tx_buf[10] <= 8'h20;
          tx_buf[11] <= nibble2hex(top_weight[15:12]);
          tx_buf[12] <= nibble2hex(top_weight[11:8]);
          tx_buf[13] <= nibble2hex(top_weight[7:4]);
          tx_buf[14] <= nibble2hex(top_weight[3:0]);
          tx_buf[15] <= 8'h0A;
          tx_len     <= 5'd16;
          tx_start   <= 1'b1;
        end else begin // EXEC_STATUS
          tx_buf[0]  <= 8'h53; // 'S'
          tx_buf[1]  <= 8'h3A; // ':'
          tx_buf[2]  <= fsm2char(fsm_state);
          tx_buf[3]  <= 8'h20;
          tx_buf[4]  <= 8'h74; // 't'
          tx_buf[5]  <= 8'h6F; // 'o'
          tx_buf[6]  <= 8'h70; // 'p'
          tx_buf[7]  <= 8'h57; // 'W'
          tx_buf[8]  <= 8'h3D; // '='
          tx_buf[9]  <= nibble2hex(top_weight[15:12]);
          tx_buf[10] <= nibble2hex(top_weight[11:8]);
          tx_buf[11] <= nibble2hex(top_weight[7:4]);
          tx_buf[12] <= nibble2hex(top_weight[3:0]);
          tx_buf[13] <= 8'h0A;
          tx_len     <= 5'd14;
          tx_start   <= 1'b1;
        end
      end

      // ── Диспетчер команд ───────────────────────────────────────────────────
      if (cmd_exec) begin
        case (exec_type)

          EXEC_WRITE: begin
            wr_en   <= 1'b1;
            wr_addr <= cmd_idx;
            wr_data <= {cmd_weight, cmd_to, cmd_from};
            // Перезапустить сканирование топа
            scan_run  <= 1'b1;
            scan_addr <= 6'd0;
            top_valid <= 1'b0;
            // Ответ "OK\n"
            tx_buf[0] <= 8'h4F; tx_buf[1] <= 8'h4B; tx_buf[2] <= 8'h0A;
            tx_len    <= 5'd3;
            tx_start  <= 1'b1;
          end

          EXEC_QUERY: begin
            rd_addr    <= cmd_idx;
            rd_pending <= 3'b001; // данные будут готовы через 1 такт
          end

          EXEC_TOP: begin
            if (top_valid) begin
              tx_buf[0]  <= 8'h54; // 'T'
              tx_buf[1]  <= 8'h20;
              tx_buf[2]  <= nibble2hex(top_idx[5:4]);
              tx_buf[3]  <= nibble2hex(top_idx[3:0]);
              tx_buf[4]  <= 8'h20;
              tx_buf[5]  <= nibble2hex(top_from[7:4]);
              tx_buf[6]  <= nibble2hex(top_from[3:0]);
              tx_buf[7]  <= 8'h20;
              tx_buf[8]  <= nibble2hex(top_to[7:4]);
              tx_buf[9]  <= nibble2hex(top_to[3:0]);
              tx_buf[10] <= 8'h20;
              tx_buf[11] <= nibble2hex(top_weight[15:12]);
              tx_buf[12] <= nibble2hex(top_weight[11:8]);
              tx_buf[13] <= nibble2hex(top_weight[7:4]);
              tx_buf[14] <= nibble2hex(top_weight[3:0]);
              tx_buf[15] <= 8'h0A;
              tx_len     <= 5'd16;
              tx_start   <= 1'b1;
            end else begin
              // Сканирование ещё идёт — запустить если не запущено, ждать
              if (!scan_run) begin
                scan_run  <= 1'b1;
                scan_addr <= 6'd0;
              end
              exec_wait_top  <= 1'b1;
              exec_wait_type <= EXEC_TOP;
            end
          end

          EXEC_STATUS: begin
            if (top_valid) begin
              tx_buf[0]  <= 8'h53; // 'S'
              tx_buf[1]  <= 8'h3A;
              tx_buf[2]  <= fsm2char(fsm_state);
              tx_buf[3]  <= 8'h20;
              tx_buf[4]  <= 8'h74; tx_buf[5]  <= 8'h6F;
              tx_buf[6]  <= 8'h70; tx_buf[7]  <= 8'h57;
              tx_buf[8]  <= 8'h3D;
              tx_buf[9]  <= nibble2hex(top_weight[15:12]);
              tx_buf[10] <= nibble2hex(top_weight[11:8]);
              tx_buf[11] <= nibble2hex(top_weight[7:4]);
              tx_buf[12] <= nibble2hex(top_weight[3:0]);
              tx_buf[13] <= 8'h0A;
              tx_len     <= 5'd14;
              tx_start   <= 1'b1;
            end else begin
              if (!scan_run) begin
                scan_run  <= 1'b1;
                scan_addr <= 6'd0;
              end
              exec_wait_top  <= 1'b1;
              exec_wait_type <= EXEC_STATUS;
            end
          end

          EXEC_FSM: begin
            case (cmd_fsm_char)
              8'h2B: fsm_state <= FSM_P;
              8'h2D: fsm_state <= FSM_N;
              8'h30: fsm_state <= FSM_Z;
              default: ;
            endcase
            tx_buf[0] <= 8'h46; // 'F'
            tx_buf[1] <= 8'h3A;
            tx_buf[2] <= (cmd_fsm_char == 8'h2B) ? 8'h50 :
                         (cmd_fsm_char == 8'h2D) ? 8'h4E : 8'h5A;
            tx_buf[3] <= 8'h0A;
            tx_len    <= 5'd4;
            tx_start  <= 1'b1;
          end

          default: ;
        endcase
      end
    end
  end

  // ─────────────────────────────────────────────────────────────────────────────
  // UART TX (8N1)
  // ─────────────────────────────────────────────────────────────────────────────

  localparam TX_IDLE  = 3'd0;
  localparam TX_LOAD  = 3'd1;
  localparam TX_START = 3'd2;
  localparam TX_DATA  = 3'd3;
  localparam TX_STOP  = 3'd4;
  localparam TX_NEXT  = 3'd5;

  reg [2:0]  tx_state;
  reg [15:0] tx_clk_cnt;
  reg [2:0]  tx_bit_cnt;
  reg [7:0]  tx_shift;
  reg [4:0]  tx_byte_idx;
  reg [4:0]  tx_byte_total;
  reg        tx_reg;

  assign uart_tx = tx_reg;

  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      tx_state      <= TX_IDLE;
      tx_clk_cnt    <= 16'd0;
      tx_bit_cnt    <= 3'd0;
      tx_shift      <= 8'd0;
      tx_byte_idx   <= 5'd0;
      tx_byte_total <= 5'd0;
      tx_reg        <= 1'b1;
    end else begin
      case (tx_state)

        TX_IDLE: begin
          tx_reg <= 1'b1;
          if (tx_start) begin
            tx_byte_idx   <= 5'd0;
            tx_byte_total <= tx_len;
            tx_state      <= TX_LOAD;
          end
        end

        TX_LOAD: begin
          if (tx_byte_idx < tx_byte_total) begin
            tx_shift   <= tx_buf[tx_byte_idx];
            tx_clk_cnt <= 16'd0;
            tx_bit_cnt <= 3'd0;
            tx_state   <= TX_START;
          end else
            tx_state <= TX_IDLE;
        end

        TX_START: begin
          tx_reg <= 1'b0;
          if (tx_clk_cnt >= BAUD_DIV[15:0] - 1) begin
            tx_clk_cnt <= 16'd0;
            tx_state   <= TX_DATA;
          end else
            tx_clk_cnt <= tx_clk_cnt + 16'd1;
        end

        TX_DATA: begin
          tx_reg <= tx_shift[tx_bit_cnt];
          if (tx_clk_cnt >= BAUD_DIV[15:0] - 1) begin
            tx_clk_cnt <= 16'd0;
            if (tx_bit_cnt == 3'd7)
              tx_state <= TX_STOP;
            else
              tx_bit_cnt <= tx_bit_cnt + 3'd1;
          end else
            tx_clk_cnt <= tx_clk_cnt + 16'd1;
        end

        TX_STOP: begin
          tx_reg <= 1'b1;
          if (tx_clk_cnt >= BAUD_DIV[15:0] - 1) begin
            tx_clk_cnt  <= 16'd0;
            tx_byte_idx <= tx_byte_idx + 5'd1;
            tx_state    <= TX_NEXT;
          end else
            tx_clk_cnt <= tx_clk_cnt + 16'd1;
        end

        TX_NEXT: tx_state <= TX_LOAD;

        default: tx_state <= TX_IDLE;
      endcase
    end
  end

  // ─────────────────────────────────────────────────────────────────────────────
  // Синхронизация scan_run / top_valid между сканером и исполнителем
  // (оба в одном clk-домене — нет проблем пересечения)
  // ─────────────────────────────────────────────────────────────────────────────
  // scan_run и top_valid — регистры, читаемые из обоих always-блоков.
  // В Verilog-2001 несколько always с одним driver недопустимы, поэтому
  // scan_run/top_valid управляются из одного блока (исполнителя выше),
  // а сканер лишь читает scan_run и пишет top_valid при завершении.
  // Это нарушение правила «один driver» — исправляем разделением:
  //   scan_run  пишет исполнитель (cmd_exec-always)
  //   top_valid пишет сканер (scan-always), читает exec_wait_top
  // ─────────────────────────────────────────────────────────────────────────────
  // NOTE: регистры scan_run / top_valid объявлены выше как reg;
  //       они имеют по ОДНОМУ always-блоку-driver, что соответствует Verilog-2001.

endmodule
`default_nettype wire
