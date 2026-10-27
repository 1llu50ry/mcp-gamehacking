/* Demo Quest DS platform part: what only a DS game has. A BIOS call from the secure area, a routine that runs from
 * the ITCM and data in the DTCM, used once per frame. Written for decomp.wtf (CC0). */
typedef unsigned int u32;
typedef signed int s32;

void SVC_WaitByLoop(s32 count);
void itcm_fill32(void *dest, u32 value, u32 words);
extern u32 dtcm_scratch[4];
extern s32 g_frame_count;

void ds_frame(void) {
    SVC_WaitByLoop(64);
    itcm_fill32(dtcm_scratch, dtcm_scratch[0] ^ (u32)g_frame_count, 3);
}
