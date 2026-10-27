/* zlib 1.1.4 built for N64 with GCC 2.7.2.
 * zlib (C) 1995-2002 Jean-loup Gailly and Mark Adler, zlib license (LICENSE.zlib).
 * Header for infblock.c: everything it includes, inlined, plus its own declarations (no function bodies). */
#ifndef _Z_UTIL_H
#define _Z_UTIL_H
#ifndef _ZLIB_H
#define _ZLIB_H
#ifndef _ZCONF_H
#define _ZCONF_H
#ifdef Z_PREFIX
#  define deflateInit_	z_deflateInit_
#  define deflate	z_deflate
#  define deflateEnd	z_deflateEnd
#  define inflateInit_ 	z_inflateInit_
#  define inflate	z_inflate
#  define inflateEnd	z_inflateEnd
#  define deflateInit2_	z_deflateInit2_
#  define deflateSetDictionary z_deflateSetDictionary
#  define deflateCopy	z_deflateCopy
#  define deflateReset	z_deflateReset
#  define deflateParams	z_deflateParams
#  define inflateInit2_	z_inflateInit2_
#  define inflateSetDictionary z_inflateSetDictionary
#  define inflateSync	z_inflateSync
#  define inflateSyncPoint z_inflateSyncPoint
#  define inflateReset	z_inflateReset
#  define compress	z_compress
#  define compress2	z_compress2
#  define uncompress	z_uncompress
#  define adler32	z_adler32
#  define crc32		z_crc32
#  define get_crc_table z_get_crc_table
#  define Byte		z_Byte
#  define uInt		z_uInt
#  define uLong		z_uLong
#  define Bytef	        z_Bytef
#  define charf		z_charf
#  define intf		z_intf
#  define uIntf		z_uIntf
#  define uLongf	z_uLongf
#  define voidpf	z_voidpf
#  define voidp		z_voidp
#endif
#if (defined(_WIN32) || defined(__WIN32__)) && !defined(WIN32)
#  define WIN32
#endif
#if defined(__GNUC__) || defined(WIN32) || defined(__386__) || defined(i386)
#  ifndef __32BIT__
#    define __32BIT__
#  endif
#endif
#if defined(__MSDOS__) && !defined(MSDOS)
#  define MSDOS
#endif
#if defined(MSDOS) && !defined(__32BIT__)
#  define MAXSEG_64K
#endif
#ifdef MSDOS
#  define UNALIGNED_OK
#endif
#if (defined(MSDOS) || defined(_WINDOWS) || defined(WIN32))  && !defined(STDC)
#  define STDC
#endif
#if defined(__STDC__) || defined(__cplusplus) || defined(__OS2__)
#  ifndef STDC
#    define STDC
#  endif
#endif
#ifndef STDC
#  ifndef const 
#    define const
#  endif
#endif
#if defined(__MWERKS__) || defined(applec) ||defined(THINK_C) ||defined(__SC__)
#  define NO_DUMMY_DECL
#endif
#if defined(__BORLANDC__) && (__BORLANDC__ < 0x500)
#  define NEED_DUMMY_RETURN
#endif
#ifndef MAX_MEM_LEVEL
#  ifdef MAXSEG_64K
#    define MAX_MEM_LEVEL 8
#  else
#    define MAX_MEM_LEVEL 9
#  endif
#endif
#ifndef MAX_WBITS
#  define MAX_WBITS   15 
#endif
#ifndef OF 
#  ifdef STDC
#    define OF(args)  args
#  else
#    define OF(args)  ()
#  endif
#endif
#if (defined(M_I86SM) || defined(M_I86MM)) && !defined(__32BIT__)
#  define SMALL_MEDIUM
#  ifdef _MSC_VER
#    define FAR _far
#  else
#    define FAR far
#  endif
#endif
#if defined(__BORLANDC__) && (defined(__SMALL__) || defined(__MEDIUM__))
#  ifndef __32BIT__
#    define SMALL_MEDIUM
#    define FAR _far
#  endif
#endif
#if defined(ZLIB_DLL)
#  if defined(_WINDOWS) || defined(WINDOWS)
#    ifdef FAR
#      undef FAR
#    endif
#    include <windows.h>
#    define ZEXPORT  WINAPI
#    ifdef WIN32
#      define ZEXPORTVA  WINAPIV
#    else
#      define ZEXPORTVA  FAR _cdecl _export
#    endif
#  endif
#  if defined (__BORLANDC__)
#    if (__BORLANDC__ >= 0x0500) && defined (WIN32)
#      include <windows.h>
#      define ZEXPORT __declspec(dllexport) WINAPI
#      define ZEXPORTRVA __declspec(dllexport) WINAPIV
#    else
#      if defined (_Windows) && defined (__DLL__)
#        define ZEXPORT _export
#        define ZEXPORTVA _export
#      endif
#    endif
#  endif
#endif
#if defined (__BEOS__)
#  if defined (ZLIB_DLL)
#    define ZEXTERN extern __declspec(dllexport)
#  else
#    define ZEXTERN extern __declspec(dllimport)
#  endif
#endif
#ifndef ZEXPORT
#  define ZEXPORT
#endif
#ifndef ZEXPORTVA
#  define ZEXPORTVA
#endif
#ifndef ZEXTERN
#  define ZEXTERN extern
#endif
#ifndef FAR
#   define FAR
#endif
#if !defined(MACOS) && !defined(TARGET_OS_MAC)
typedef unsigned char  Byte;
#endif
typedef unsigned int   uInt;
typedef unsigned long  uLong;
#ifdef SMALL_MEDIUM
#  define Bytef Byte FAR
#else
typedef Byte  FAR Bytef;
#endif
typedef char  FAR charf;
typedef int   FAR intf;
typedef uInt  FAR uIntf;
typedef uLong FAR uLongf;
#ifdef STDC
typedef void FAR *voidpf;
typedef void     *voidp;
#else
typedef Byte FAR *voidpf;
typedef Byte     *voidp;
#endif
#ifdef HAVE_UNISTD_H
#  include <sys/types.h> 
#  include <unistd.h>    
#  define z_off_t  off_t
#endif
#ifndef SEEK_SET
#  define SEEK_SET        0       
#  define SEEK_CUR        1       
#  define SEEK_END        2       
#endif
#ifndef z_off_t
#  define  z_off_t long
#endif
#if defined(__MVS__)
#   pragma map(deflateInit_,"DEIN")
#   pragma map(deflateInit2_,"DEIN2")
#   pragma map(deflateEnd,"DEEND")
#   pragma map(inflateInit_,"ININ")
#   pragma map(inflateInit2_,"ININ2")
#   pragma map(inflateEnd,"INEND")
#   pragma map(inflateSync,"INSY")
#   pragma map(inflateSetDictionary,"INSEDI")
#   pragma map(inflate_blocks,"INBL")
#   pragma map(inflate_blocks_new,"INBLNE")
#   pragma map(inflate_blocks_free,"INBLFR")
#   pragma map(inflate_blocks_reset,"INBLRE")
#   pragma map(inflate_codes_free,"INCOFR")
#   pragma map(inflate_codes,"INCO")
#   pragma map(inflate_fast,"INFA")
#   pragma map(inflate_flush,"INFLU")
#   pragma map(inflate_mask,"INMA")
#   pragma map(inflate_set_dictionary,"INSEDI2")
#   pragma map(inflate_copyright,"INCOPY")
#   pragma map(inflate_trees_bits,"INTRBI")
#   pragma map(inflate_trees_dynamic,"INTRDY")
#   pragma map(inflate_trees_fixed,"INTRFI")
#   pragma map(inflate_trees_free,"INTRFR")
#endif
#endif 
#ifdef __cplusplus
#endif
#define ZLIB_VERSION "1.1.4"
typedef voidpf (*alloc_func) OF((voidpf opaque, uInt items, uInt size));
typedef void   (*free_func)  OF((voidpf opaque, voidpf address));
struct internal_state;
typedef struct z_stream_s {
    Bytef    *next_in;  
    uInt     avail_in;  
    uLong    total_in;  

    Bytef    *next_out; 
    uInt     avail_out; 
    uLong    total_out; 

    char     *msg;      
    struct internal_state FAR *state; 

    alloc_func zalloc;  
    free_func  zfree;   
    voidpf     opaque;  

    int     data_type;  
    uLong   adler;      
    uLong   reserved;   
} z_stream;
typedef z_stream FAR *z_streamp;
#define Z_NO_FLUSH      0
#define Z_PARTIAL_FLUSH 1 
#define Z_SYNC_FLUSH    2
#define Z_FULL_FLUSH    3
#define Z_FINISH        4
#define Z_OK            0
#define Z_STREAM_END    1
#define Z_NEED_DICT     2
#define Z_ERRNO        (-1)
#define Z_STREAM_ERROR (-2)
#define Z_DATA_ERROR   (-3)
#define Z_MEM_ERROR    (-4)
#define Z_BUF_ERROR    (-5)
#define Z_VERSION_ERROR (-6)
#define Z_NO_COMPRESSION         0
#define Z_BEST_SPEED             1
#define Z_BEST_COMPRESSION       9
#define Z_DEFAULT_COMPRESSION  (-1)
#define Z_FILTERED            1
#define Z_HUFFMAN_ONLY        2
#define Z_DEFAULT_STRATEGY    0
#define Z_BINARY   0
#define Z_ASCII    1
#define Z_UNKNOWN  2
#define Z_DEFLATED   8
#define Z_NULL  0  
#define zlib_version zlibVersion()
ZEXTERN const char * ZEXPORT zlibVersion OF((void));
ZEXTERN int ZEXPORT deflate OF((z_streamp strm, int flush));
ZEXTERN int ZEXPORT deflateEnd OF((z_streamp strm));
ZEXTERN int ZEXPORT inflate OF((z_streamp strm, int flush));
ZEXTERN int ZEXPORT inflateEnd OF((z_streamp strm));
ZEXTERN int ZEXPORT deflateSetDictionary OF((z_streamp strm,
                                             const Bytef *dictionary,
                                             uInt  dictLength));
ZEXTERN int ZEXPORT deflateCopy OF((z_streamp dest,
                                    z_streamp source));
ZEXTERN int ZEXPORT deflateReset OF((z_streamp strm));
ZEXTERN int ZEXPORT deflateParams OF((z_streamp strm,
				      int level,
				      int strategy));
ZEXTERN int ZEXPORT inflateSetDictionary OF((z_streamp strm,
                                             const Bytef *dictionary,
                                             uInt  dictLength));
ZEXTERN int ZEXPORT inflateSync OF((z_streamp strm));
ZEXTERN int ZEXPORT inflateReset OF((z_streamp strm));
ZEXTERN int ZEXPORT compress OF((Bytef *dest,   uLongf *destLen,
                                 const Bytef *source, uLong sourceLen));
ZEXTERN int ZEXPORT compress2 OF((Bytef *dest,   uLongf *destLen,
                                  const Bytef *source, uLong sourceLen,
                                  int level));
ZEXTERN int ZEXPORT uncompress OF((Bytef *dest,   uLongf *destLen,
                                   const Bytef *source, uLong sourceLen));
typedef voidp gzFile;
ZEXTERN gzFile ZEXPORT gzopen  OF((const char *path, const char *mode));
ZEXTERN gzFile ZEXPORT gzdopen  OF((int fd, const char *mode));
ZEXTERN int ZEXPORT gzsetparams OF((gzFile file, int level, int strategy));
ZEXTERN int ZEXPORT    gzread  OF((gzFile file, voidp buf, unsigned len));
ZEXTERN int ZEXPORT    gzwrite OF((gzFile file, 
				   const voidp buf, unsigned len));
ZEXTERN int ZEXPORTVA   gzprintf OF((gzFile file, const char *format, ...));
ZEXTERN int ZEXPORT gzputs OF((gzFile file, const char *s));
ZEXTERN char * ZEXPORT gzgets OF((gzFile file, char *buf, int len));
ZEXTERN int ZEXPORT    gzputc OF((gzFile file, int c));
ZEXTERN int ZEXPORT    gzgetc OF((gzFile file));
ZEXTERN int ZEXPORT    gzflush OF((gzFile file, int flush));
ZEXTERN z_off_t ZEXPORT    gzseek OF((gzFile file,
				      z_off_t offset, int whence));
ZEXTERN int ZEXPORT    gzrewind OF((gzFile file));
ZEXTERN z_off_t ZEXPORT    gztell OF((gzFile file));
ZEXTERN int ZEXPORT gzeof OF((gzFile file));
ZEXTERN int ZEXPORT    gzclose OF((gzFile file));
ZEXTERN const char * ZEXPORT gzerror OF((gzFile file, int *errnum));
ZEXTERN uLong ZEXPORT adler32 OF((uLong adler, const Bytef *buf, uInt len));
ZEXTERN uLong ZEXPORT crc32   OF((uLong crc, const Bytef *buf, uInt len));
ZEXTERN int ZEXPORT deflateInit_ OF((z_streamp strm, int level,
                                     const char *version, int stream_size));
ZEXTERN int ZEXPORT inflateInit_ OF((z_streamp strm,
                                     const char *version, int stream_size));
ZEXTERN int ZEXPORT deflateInit2_ OF((z_streamp strm, int  level, int  method,
                                      int windowBits, int memLevel,
                                      int strategy, const char *version,
                                      int stream_size));
ZEXTERN int ZEXPORT inflateInit2_ OF((z_streamp strm, int  windowBits,
                                      const char *version, int stream_size));
#define deflateInit(strm, level) \
        deflateInit_((strm), (level),       ZLIB_VERSION, sizeof(z_stream))
#define inflateInit(strm) \
        inflateInit_((strm),                ZLIB_VERSION, sizeof(z_stream))
#define deflateInit2(strm, level, method, windowBits, memLevel, strategy) \
        deflateInit2_((strm),(level),(method),(windowBits),(memLevel),\
                      (strategy),           ZLIB_VERSION, sizeof(z_stream))
#define inflateInit2(strm, windowBits) \
        inflateInit2_((strm), (windowBits), ZLIB_VERSION, sizeof(z_stream))
#if !defined(_Z_UTIL_H) && !defined(NO_DUMMY_DECL)
#endif
ZEXTERN const char   * ZEXPORT zError           OF((int err));
ZEXTERN int            ZEXPORT inflateSyncPoint OF((z_streamp z));
ZEXTERN const uLongf * ZEXPORT get_crc_table    OF((void));
#ifdef __cplusplus
#endif
#endif 
#ifdef STDC
#  include <stddef.h>
#  include <string.h>
#  include <stdlib.h>
#endif
#ifdef NO_ERRNO_H
extern int errno;
#else
#   include <errno.h>
#endif
#ifndef local
#  define local static
#endif
typedef unsigned char  uch;
typedef uch FAR uchf;
typedef unsigned short ush;
typedef ush FAR ushf;
typedef unsigned long  ulg;
extern const char *z_errmsg[10];
#define ERR_MSG(err) z_errmsg[Z_NEED_DICT-(err)]
#define ERR_RETURN(strm,err) \
  return (strm->msg = (char*)ERR_MSG(err), (err))
#ifndef DEF_WBITS
#  define DEF_WBITS MAX_WBITS
#endif
#if MAX_MEM_LEVEL >= 8
#  define DEF_MEM_LEVEL 8
#else
#  define DEF_MEM_LEVEL  MAX_MEM_LEVEL
#endif
#define STORED_BLOCK 0
#define STATIC_TREES 1
#define DYN_TREES    2
#define MIN_MATCH  3
#define MAX_MATCH  258
#define PRESET_DICT 0x20 
#ifdef MSDOS
#  define OS_CODE  0x00
#  if defined(__TURBOC__) || defined(__BORLANDC__)
#    if(__STDC__ == 1) && (defined(__LARGE__) || defined(__COMPACT__))
void _Cdecl farfree( void *block );
void *_Cdecl farmalloc( unsigned long nbytes );
#    else
#     include <alloc.h>
#    endif
#  else 
#    include <malloc.h>
#  endif
#endif
#ifdef OS2
#  define OS_CODE  0x06
#endif
#ifdef WIN32 
#  define OS_CODE  0x0b
#endif
#if defined(VAXC) || defined(VMS)
#  define OS_CODE  0x02
#  define F_OPEN(name, mode) \
     fopen((name), (mode), "mbc=60", "ctx=stm", "rfm=fix", "mrs=512")
#endif
#ifdef AMIGA
#  define OS_CODE  0x01
#endif
#if defined(ATARI) || defined(atarist)
#  define OS_CODE  0x05
#endif
#if defined(MACOS) || defined(TARGET_OS_MAC)
#  define OS_CODE  0x07
#  if defined(__MWERKS__) && __dest_os != __be_os && __dest_os != __win32_os
#    include <unix.h> 
#  else
#    ifndef fdopen
#      define fdopen(fd,mode) NULL 
#    endif
#  endif
#endif
#ifdef __50SERIES 
#  define OS_CODE  0x0F
#endif
#ifdef TOPS20
#  define OS_CODE  0x0a
#endif
#if defined(_BEOS_) || defined(RISCOS)
#  define fdopen(fd,mode) NULL 
#endif
#if (defined(_MSC_VER) && (_MSC_VER > 600))
#  define fdopen(fd,type)  _fdopen(fd,type)
#endif
#ifndef OS_CODE
#  define OS_CODE  0x03  
#endif
#ifndef F_OPEN
#  define F_OPEN(name, mode) fopen((name), (mode))
#endif
#ifdef HAVE_STRERROR
extern char *strerror OF((int));
#  define zstrerror(errnum) strerror(errnum)
#else
#  define zstrerror(errnum) ""
#endif
#if defined(pyr)
#  define NO_MEMCPY
#endif
#if defined(SMALL_MEDIUM) && !defined(_MSC_VER) && !defined(__SC__)
#  define NO_MEMCPY
#endif
#if defined(STDC) && !defined(HAVE_MEMCPY) && !defined(NO_MEMCPY)
#  define HAVE_MEMCPY
#endif
#ifdef HAVE_MEMCPY
#  ifdef SMALL_MEDIUM 
#    define zmemcpy _fmemcpy
#    define zmemcmp _fmemcmp
#    define zmemzero(dest, len) _fmemset(dest, 0, len)
#  else
#    define zmemcpy memcpy
#    define zmemcmp memcmp
#    define zmemzero(dest, len) memset(dest, 0, len)
#  endif
#else
extern void zmemcpy  OF((Bytef* dest, const Bytef* source, uInt len));
extern int  zmemcmp  OF((const Bytef* s1, const Bytef* s2, uInt len));
extern void zmemzero OF((Bytef* dest, uInt len));
#endif
#ifdef DEBUG
#  include <stdio.h>
extern int z_verbose;
extern void z_error    OF((char *m));
#  define Assert(cond,msg) {if(!(cond)) z_error(msg);}
#  define Trace(x) {if (z_verbose>=0) fprintf x ;}
#  define Tracev(x) {if (z_verbose>0) fprintf x ;}
#  define Tracevv(x) {if (z_verbose>1) fprintf x ;}
#  define Tracec(c,x) {if (z_verbose>0 && (c)) fprintf x ;}
#  define Tracecv(c,x) {if (z_verbose>1 && (c)) fprintf x ;}
#else
#  define Assert(cond,msg)
#  define Trace(x)
#  define Tracev(x)
#  define Tracevv(x)
#  define Tracec(c,x)
#  define Tracecv(c,x)
#endif
typedef uLong (ZEXPORT *check_func) OF((uLong check, const Bytef *buf,
				       uInt len));
voidpf zcalloc OF((voidpf opaque, unsigned items, unsigned size));
void   zcfree  OF((voidpf opaque, voidpf ptr));
#define ZALLOC(strm, items, size) \
           (*((strm)->zalloc))((strm)->opaque, (items), (size))
#define ZFREE(strm, addr)  (*((strm)->zfree))((strm)->opaque, (voidpf)(addr))
#define TRY_FREE(s, p) {if (p) ZFREE(s, p);}
#endif 
struct inflate_blocks_state;
typedef struct inflate_blocks_state FAR inflate_blocks_statef;
extern inflate_blocks_statef * inflate_blocks_new OF((
    z_streamp z,
    check_func c,               
    uInt w));
extern int inflate_blocks OF((
    inflate_blocks_statef *,
    z_streamp ,
    int));
extern void inflate_blocks_reset OF((
    inflate_blocks_statef *,
    z_streamp ,
    uLongf *));
extern int inflate_blocks_free OF((
    inflate_blocks_statef *,
    z_streamp));
extern void inflate_set_dictionary OF((
    inflate_blocks_statef *s,
    const Bytef *d,  
    uInt  n));
extern int inflate_blocks_sync_point OF((
    inflate_blocks_statef *s));
typedef struct inflate_huft_s FAR inflate_huft;
struct inflate_huft_s {
  union {
    struct {
      Byte Exop;        
      Byte Bits;        
    } what;
    uInt pad;           
  } word;               
  uInt base;            

};
#define MANY 1440
extern int inflate_trees_bits OF((
    uIntf *,                    
    uIntf *,                    
    inflate_huft * FAR *,       
    inflate_huft *,             
    z_streamp));
extern int inflate_trees_dynamic OF((
    uInt,                       
    uInt,                       
    uIntf *,                    
    uIntf *,                    
    uIntf *,                    
    inflate_huft * FAR *,       
    inflate_huft * FAR *,       
    inflate_huft *,             
    z_streamp));
extern int inflate_trees_fixed OF((
    uIntf *,                    
    uIntf *,                    
    inflate_huft * FAR *,       
    inflate_huft * FAR *,       
    z_streamp));
struct inflate_codes_state;
typedef struct inflate_codes_state FAR inflate_codes_statef;
extern inflate_codes_statef *inflate_codes_new OF((
    uInt, uInt,
    inflate_huft *, inflate_huft *,
    z_streamp ));
extern int inflate_codes OF((
    inflate_blocks_statef *,
    z_streamp ,
    int));
extern void inflate_codes_free OF((
    inflate_codes_statef *,
    z_streamp ));
#ifndef _INFUTIL_H
#define _INFUTIL_H
typedef enum {
      TYPE,     
      LENS,     
      STORED,   
      TABLE,    
      BTREE,    
      DTREE,    
      CODES,    
      DRY,      
      DONE,     
      BAD}      
inflate_block_mode;
struct inflate_blocks_state {

  
  inflate_block_mode  mode;     

  
  union {
    uInt left;          
    struct {
      uInt table;               
      uInt index;               
      uIntf *blens;             
      uInt bb;                  
      inflate_huft *tb;         
    } trees;            
    struct {
      inflate_codes_statef 
         *codes;
    } decode;           
  } sub;                
  uInt last;            

  
  uInt bitk;            
  uLong bitb;           
  inflate_huft *hufts;  
  Bytef *window;        
  Bytef *end;           
  Bytef *read;          
  Bytef *write;         
  check_func checkfn;   
  uLong check;          

};
#define UPDBITS {s->bitb=b;s->bitk=k;}
#define UPDIN {z->avail_in=n;z->total_in+=p-z->next_in;z->next_in=p;}
#define UPDOUT {s->write=q;}
#define UPDATE {UPDBITS UPDIN UPDOUT}
#define LEAVE {UPDATE return inflate_flush(s,z,r);}
#define LOADIN {p=z->next_in;n=z->avail_in;b=s->bitb;k=s->bitk;}
#define NEEDBYTE {if(n)r=Z_OK;else LEAVE}
#define NEXTBYTE (n--,*p++)
#define NEEDBITS(j) {while(k<(j)){NEEDBYTE;b|=((uLong)NEXTBYTE)<<k;k+=8;}}
#define DUMPBITS(j) {b>>=(j);k-=(j);}
#define WAVAIL (uInt)(q<s->read?s->read-q-1:s->end-q)
#define LOADOUT {q=s->write;m=(uInt)WAVAIL;}
#define WRAP {if(q==s->end&&s->read!=s->window){q=s->window;m=(uInt)WAVAIL;}}
#define FLUSH {UPDOUT r=inflate_flush(s,z,r); LOADOUT}
#define NEEDOUT {if(m==0){WRAP if(m==0){FLUSH WRAP if(m==0) LEAVE}}r=Z_OK;}
#define OUTBYTE(a) {*q++=(Byte)(a);m--;}
#define LOAD {LOADIN LOADOUT}
extern uInt inflate_mask[17];
extern int inflate_flush OF((
    inflate_blocks_statef *,
    z_streamp ,
    int));
#endif
#define exop word.what.Exop
#define bits word.what.Bits
extern const uInt border[];
